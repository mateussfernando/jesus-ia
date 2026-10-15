import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildCsp, createNonce, securityHeaders } from './server/csp';
import { isAllowedRequestHost } from './server/host';

/**
 * Proxy do Next (antigo middleware; decisão 0016). Antes de tudo, recusa `Host` fora da lista (DNS rebinding;
 * `server/host.ts`). Depois, cada resposta recebe um nonce novo na CSP: o Next lê a CSP do pedido, aplica o nonce
 * aos próprios scripts e estilos, e a mesma política vai na resposta.
 */
export function proxy(request: NextRequest) {
  // No app instalado (`JESUS_HTTPS=1`, posto pelo apps/desktop), só `jesus.invalid`.
  const appMode = process.env['JESUS_HTTPS'] === '1';
  if (!isAllowedRequestHost(request.headers.get('host'), request.headers.get('x-forwarded-host'), appMode)) {
    return new NextResponse('Endereço não atendido.', {
      status: 421,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders },
    });
  }
  const csp = buildCsp(createNonce(), { dev: process.env.NODE_ENV === 'development' });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Tudo passa pelo proxy, menos os arquivos estáticos do build (`/_next/static/…`, com a barra). Sem exceção por
  // cabeçalho: um pedido com `next-router-prefetch` também é conferido (senão bastaria mandar esse cabeçalho para
  // pular a checagem do Host).
  matcher: ['/((?!_next/static/).*)'],
};
