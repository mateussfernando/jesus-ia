/**
 * Conferência de origem das rotas (decisão 0025). As Server Actions do Next já comparam `Origin` com `Host`; as rotas
 * não. O cookie da sessão é `SameSite=Strict`, mas "mesmo site" não olha a porta: no desenvolvimento, uma página em
 * `http://127.0.0.1:8080` é do mesmo site que o Jesus em `http://127.0.0.1:5173`, e o navegador mandaria o cookie.
 *
 * No app de desktop, os pedidos da janela chegam pelo `protocol.handle` sem `Origin` nem `Sec-Fetch-*` (seção 3.12), e
 * só documentos do próprio app rodam naquela sessão: sem os cabeçalhos, o pedido passa. Quando eles vêm, precisam dizer
 * que o pedido é da mesma origem.
 */

type HeaderReader = Pick<Headers, 'get'>;

export function isSameOriginRequest(headers: HeaderReader): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = headers.get('origin');
  if (origin === null) return true;
  const host = headers.get('host');
  if (host === null) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host.trim().toLowerCase();
}

/**
 * O corpo diz que é JSON. Um formulário de outra origem só consegue mandar os tipos "simples" (texto, formulário) sem
 * pedir licença antes ao servidor, e esta rota não dá licença a ninguém.
 */
export function isJsonRequest(headers: HeaderReader): boolean {
  const type = headers.get('content-type');
  return type !== null && type.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}
