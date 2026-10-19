import { checkAnthropicKey } from '@jesus/shared';
import type { Vault } from '../vault';
import type { KeyRead } from './egress';

/**
 * A chave da API, lida do cofre na hora de cada pedido (decisão 0023): o texto aberto só existe na memória do principal
 * durante a montagem dos cabeçalhos. A forma é conferida de novo (o cofre só guarda chave conferida, mas um cofre
 * mexido não manda uma chave de administrador para fora).
 */
export function readApiKey(vault: Pick<Vault, 'get'>): KeyRead {
  let key: string | null;
  try {
    key = vault.get('anthropic_api_key');
  } catch {
    return { ok: false, problem: 'vault' };
  }
  if (key === null) return { ok: false, problem: 'no_key' };
  return checkAnthropicKey(key).ok ? { ok: true, key } : { ok: false, problem: 'vault' };
}
