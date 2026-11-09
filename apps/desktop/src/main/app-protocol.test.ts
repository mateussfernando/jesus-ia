import { describe, expect, it } from 'vitest';
import { handleAppRequest } from './app-protocol';
import { CookieJar } from './cookie-jar';

const APP = 'https://jesus.invalid';

function recorder(respond: (request: Request) => Response) {
  const seen: Request[] = [];
  return {
    seen,
    serve: (request: Request) => {
      seen.push(request);
      return Promise.resolve(respond(request));
    },
  };
}

describe('protocol.handle da janela do Jesus', () => {
  it('fora do app, 403 sem chamar o servidor da interface', async () => {
    const { seen, serve } = recorder(() => new Response('ok'));
    for (const url of ['https://example.com/', 'https://jesus.invalid.example/', 'https://jesus.invalid:8443/']) {
      expect((await handleAppRequest(new Request(url), serve, new CookieJar())).status).toBe(403);
    }
    expect(seen).toHaveLength(0);
  });

  it('o cookie da sessão fica no pote: entra no pedido e nunca volta para o Chromium', async () => {
    const jar = new CookieJar();
    const login = recorder(
      () =>
        new Response(null, {
          status: 303,
          headers: [
            ['location', '/'],
            ['set-cookie', 'jesus_session=abc; Path=/; HttpOnly; Secure; SameSite=Strict'],
          ],
        }),
    );
    const first = await handleAppRequest(new Request(`${APP}/entrar/`, { method: 'POST', body: '[]' }), login.serve, jar);
    expect(first.headers.get('set-cookie')).toBeNull();
    expect(jar.headerFor(`${APP}/`)).toBe('jesus_session=abc');

    const next = recorder(() => new Response('início'));
    // O cookie que a página mandasse é descartado; vale o do pote.
    await handleAppRequest(new Request(`${APP}/`, { headers: { cookie: 'jesus_session=forjado' } }), next.serve, jar);
    expect(next.seen[0]?.headers.get('cookie')).toBe('jesus_session=abc');
  });

  it('sem cookie no pote, o pedido vai sem cookie nenhum', async () => {
    const { seen, serve } = recorder(() => new Response('ok'));
    await handleAppRequest(new Request(`${APP}/`, { headers: { cookie: 'x=1' } }), serve, new CookieJar());
    expect(seen[0]?.headers.get('cookie')).toBeNull();
  });

  it('tira a CSP das respostas 3xx (a página de destino traz a dela) e mantém nas outras', async () => {
    const csp = "default-src 'self'";
    const redirect = recorder(() => new Response(null, { status: 307, headers: { location: '/entrar/', 'content-security-policy': csp } }));
    const response = await handleAppRequest(new Request(`${APP}/`), redirect.serve, new CookieJar());
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/entrar/');
    expect(response.headers.get('content-security-policy')).toBeNull();

    const page = recorder(() => new Response('<p>oi</p>', { headers: { 'content-security-policy': csp } }));
    expect((await handleAppRequest(new Request(`${APP}/entrar/`), page.serve, new CookieJar())).headers.get('content-security-policy')).toBe(csp);
  });

  it('o corpo do POST e o método chegam ao servidor', async () => {
    let body = '';
    const serve = async (request: Request) => {
      body = await request.text();
      return new Response(request.method);
    };
    const response = await handleAppRequest(new Request(`${APP}/entrar/`, { method: 'POST', body: '["senha"]' }), serve, new CookieJar());
    expect(await response.text()).toBe('POST');
    expect(body).toBe('["senha"]');
  });
});
