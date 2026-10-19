/**
 * Chave da API da Anthropic que o Jesus aceita guardar (decisão 0020): só a chave de API comum, `sk-ant-apiNN-…`. A
 * chave de administrador (`sk-ant-admin…`) gerencia a organização inteira (chaves, membros, gastos) e é recusada: o
 * Jesus só conversa com o modelo. A conferência é só de forma; se a chave vale, a primeira chamada à API diz.
 */
export type AnthropicKeyCheck = { readonly ok: true; readonly key: string } | { readonly ok: false; readonly reason: 'admin' | 'format' };

const API_KEY = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,250}$/;

export function checkAnthropicKey(input: string): AnthropicKeyCheck {
  const key = input.trim();
  if (/^sk-ant-admin/i.test(key)) return { ok: false, reason: 'admin' };
  return API_KEY.test(key) ? { ok: true, key } : { ok: false, reason: 'format' };
}
