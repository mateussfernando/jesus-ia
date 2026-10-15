import type { CookieJar } from './cookie-jar';
import { isAppUrl } from './policy/url';
import { statusPage } from './ui-server';

/**
 * O que o `protocol.handle('https')` da sessão do Jesus faz com cada pedido da janela (seção 3.12; decisões 0016 e
 * 0017). Só `https://jesus.invalid` segue para o servidor da interface; qualquer outro endereço recebe 403 sem sair
 * do PC (a sessão também tem um proxy morto, mas o handler responde antes).
 *
 * O `protocol.handle` não guarda nem manda cookies: quem faz isso é o pote do principal. O cookie que a página
 * mandasse é descartado, e o `Set-Cookie` nunca chega ao Chromium (a página não vê a sessão nem por `document.cookie`).
 */

export type ServeApp = (request: Request) => Promise<Response>;

/** Resposta para tudo o que não é do app: outros sites, `http:` e `file:`. */
export function refuseRequest(): Response {
  return statusPage(403);
}

export async function handleAppRequest(request: Request, serve: ServeApp, jar: CookieJar): Promise<Response> {
  if (!isAppUrl(request.url)) return refuseRequest();
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  const cookie = jar.headerFor(request.url);
  if (cookie !== null) headers.set('cookie', cookie);
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: request.body,
    duplex: 'half',
    signal: request.signal,
  };
  const response = await serve(new Request(request.url, init));
  jar.storeFromResponse(request.url, response.headers.getSetCookie());
  const out = new Headers(response.headers);
  out.delete('set-cookie');
  // No Electron 44.7.0, a página depois de um 3xx herda a CSP da resposta 3xx (com outro nonce) e não carrega os
  // próprios scripts. O 3xx não tem conteúdo para proteger; a CSP vale na página de destino.
  if (response.status >= 300 && response.status < 400) out.delete('content-security-policy');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
}
