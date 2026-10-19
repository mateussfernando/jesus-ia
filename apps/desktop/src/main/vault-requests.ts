import { checkAnthropicKey } from '@jesus/shared';
import type { AuditEvent } from '@jesus/shared/audit';
import type { VaultReply, VaultRequest } from '../bridge/protocol';
import type { Vault } from './vault';

/**
 * Pedidos do servidor da interface ao cofre (decisão 0020). O principal decide tudo: confere a forma da chave de novo
 * (a tela já conferiu, mas a tela não manda aqui), recusa a chave de administrador, guarda cifrada e registra o fato,
 * nunca a chave. A resposta diz só se há chave guardada.
 */

export type VaultResult = Omit<VaultReply, 'type' | 'id'>;
type VaultLike = Pick<Vault, 'problem' | 'has' | 'set' | 'delete'>;

function keyState(vault: VaultLike): VaultResult['anthropicKey'] {
  try {
    return vault.has('anthropic_api_key') ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

export function handleVaultRequest(request: VaultRequest, vault: VaultLike, record: (event: AuditEvent) => void): VaultResult {
  const problem = vault.problem();
  switch (request.op) {
    case 'status':
      return { ok: problem === null, anthropicKey: keyState(vault), ...(problem === null ? {} : { problem }) };
    case 'set-anthropic-key': {
      const check = checkAnthropicKey(request.key ?? '');
      if (!check.ok) {
        record({ type: 'vault.key_refused', provider: 'anthropic', reason: check.reason });
        return { ok: false, anthropicKey: keyState(vault), problem: check.reason };
      }
      if (problem !== null) return { ok: false, anthropicKey: keyState(vault), problem };
      try {
        vault.set('anthropic_api_key', check.key);
      } catch {
        return { ok: false, anthropicKey: keyState(vault), problem: 'failed' };
      }
      record({ type: 'vault.key_saved', provider: 'anthropic' });
      return { ok: true, anthropicKey: 'present' };
    }
    case 'clear-anthropic-key':
      // Apagar não precisa de cifra: vale até com o cofre indisponível.
      try {
        vault.delete('anthropic_api_key');
      } catch {
        return { ok: false, anthropicKey: keyState(vault), problem: 'failed' };
      }
      record({ type: 'vault.key_removed', provider: 'anthropic' });
      return { ok: true, anthropicKey: 'absent' };
  }
}
