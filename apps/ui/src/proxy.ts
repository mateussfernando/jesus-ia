import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildCsp, createNonce, securityHeaders } from './server/csp';

/**
 * Proxy do Next (antigo middleware; decisão 0016): cada página recebe um nonce novo na CSP. O Next lê a CSP do
 * pedido, aplica o nonce aos próprios scripts e estilos, e a mesma política vai na resposta.
 */
export function proxy(request: NextRequest) {
  const csp = buildCsp(createNonce(), { dev: process.env.NODE_ENV === 'development' });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
