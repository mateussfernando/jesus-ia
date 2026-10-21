import { checkAnthropicKey } from '@jesus/shared';
import type { AuditEvent } from '@jesus/shared/audit';
import type { VaultReply, VaultRequest } from '../bridge/protocol';
import { readApiKey } from './egress/api-key';
import type { Vault } from './vault';

/**
 * Pedidos do servidor da interface ao cofre (decisão 0020). O principal decide tudo: confere a forma da chave de novo
 * (a tela já conferiu, mas a tela não manda aqui), recusa a chave de administrador, guarda cifrada e registra o fato,
 * nunca a chave. A resposta diz só se há chave guardada (e que abre).
 *
 * Um servidor da interface comprometido não afoga o registro nem o disco: guardar e apagar (inclusive as tentativas
 * recusadas) têm um limite por minuto, e as recusas vão ao registro no máximo uma vez por minuto, com a contagem das
 * que ficaram de fora (como na saída para a API).
 */

export type VaultResult = Omit<VaultReply, 'type' | 'id'>;
type VaultLike = Pick<Vault, 'problem' | 'has' | 'get' | 'set' | 'delete'>;

/** Gravações (guardar ou apagar a chave) aceitas por minuto. O dono nunca chega perto disso. */
export const MAX_VAULT_WRITES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** Guardada só conta se abre: a cifra pode ter mudado (pasta restaurada noutra máquina, perfil refeito). */
function keyState(vault: VaultLike): VaultResult['anthropicKey'] {
  try {
    if (!vault.has('anthropic_api_key')) return 'absent';
    // Sem o cofre, não dá para abrir: fica a palavra do arquivo.
    if (vault.problem() !== null) return 'present';
  } catch {
    return 'unknown';
  }
  const read = readApiKey(vault);
  return read.ok ? 'present' : read.problem === 'no_key' ? 'absent' : 'unknown';
}

export interface VaultRequestsOptions {
  readonly vault: VaultLike;
  /** Grava no registro de auditoria (sem esperar). */
  readonly record: (event: AuditEvent) => void;
  readonly now?: () => number;
}

export function createVaultRequests(options: VaultRequestsOptions): (request: VaultRequest) => VaultResult {
  const { vault, record } = options;
  const now = options.now ?? (() => performance.now());
  const writes: number[] = [];
  const throttle = new Map<string, { at: number; suppressed: number }>();

  /** Grava no máximo uma vez por minuto por tipo, contando as que ficaram de fora. */
  const recordThrottled = (event: AuditEvent) => {
    const at = now();
    const last = throttle.get(event.type);
    if (last !== undefined && at - last.at < MINUTE_MS) {
      last.suppressed += 1;
      return;
    }
    throttle.set(event.type, { at, suppressed: 0 });
    record({ ...event, ...(last !== undefined && last.suppressed > 0 ? { suppressed: last.suppressed } : {}) });
  };

  /** Mais uma gravação cabe no minuto? */
  const allowWrite = (): boolean => {
    const at = now();
    while (writes.length > 0 && at - (writes[0] ?? at) >= MINUTE_MS) writes.shift();
    if (writes.length >= MAX_VAULT_WRITES_PER_MINUTE) {
      recordThrottled({ type: 'vault.throttled' });
      return false;
    }
    writes.push(at);
    return true;
  };

  return (request) => {
    const problem = vault.problem();
    switch (request.op) {
      case 'status':
        return { ok: problem === null, anthropicKey: keyState(vault), ...(problem === null ? {} : { problem }) };
      case 'set-anthropic-key': {
        if (!allowWrite()) return { ok: false, anthropicKey: keyState(vault), problem: 'failed' };
        const check = checkAnthropicKey(request.key ?? '');
        if (!check.ok) {
          recordThrottled({ type: 'vault.key_refused', provider: 'anthropic', reason: check.reason });
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
        if (!allowWrite()) return { ok: false, anthropicKey: keyState(vault), problem: 'failed' };
        // Apagar não precisa de cifra: vale até com o cofre indisponível (ou estragado, que recomeça vazio).
        try {
          vault.delete('anthropic_api_key');
        } catch {
          return { ok: false, anthropicKey: keyState(vault), problem: 'failed' };
        }
        record({ type: 'vault.key_removed', provider: 'anthropic' });
        return { ok: true, anthropicKey: 'absent' };
    }
  };
}
