import { describe, expect, it } from 'vitest';
import type { Serve } from './host';
import { createServerFetch, serverEnv } from './next-server';

const CONFIG = { type: 'config', uiDir: '/app/ui', dataDir: '/dados/jesus' } as const;

describe('fetch do servidor da interface', () => {
  function withLocal() {
    const seen: Request[] = [];
    const serve: Serve = (request) => {
      seen.push(request);
      return Promise.resolve(new Response('{"ok":true}', { headers: { 'content-type': 'text/x-component' } }));
    };
    return { seen, serverFetch: createServerFetch(serve) };
  }

  it('recusa qualquer endereço fora do app (o servidor da interface não fala com a rede)', async () => {
    const { seen, serverFetch } = withLocal();
    const forwarded = { method: 'POST', headers: { 'x-action-forwarded': '1' }, body: '[]' };
    await expect(serverFetch('https://api.anthropic.com/v1/messages', forwarded)).rejects.toThrow(TypeError);
    await expect(serverFetch('http://jesus.invalid/entrar', forwarded)).rejects.toThrow(TypeError);
    await expect(serverFetch('https://jesus.invalid:8443/entrar', forwarded)).rejects.toThrow(TypeError);
    await expect(serverFetch('http://127.0.0.1:5432/', forwarded)).rejects.toThrow(TypeError);
    expect(seen).toHaveLength(0);
  });

  it('no próprio app, só o repasse de Server Action (POST com x-action-forwarded)', async () => {
    const { seen, serverFetch } = withLocal();
    await expect(serverFetch('https://jesus.invalid/entrar/')).rejects.toThrow(TypeError);
    await expect(serverFetch('https://jesus.invalid/entrar/', { method: 'POST', body: '[]' })).rejects.toThrow(TypeError);
    expect(seen).toHaveLength(0);
  });

  it('repassa em memória, com a barra final que o trailingSlash exige', async () => {
    const { seen, serverFetch } = withLocal();
    const response = await serverFetch('https://jesus.invalid/entrar?x=1', {
      method: 'POST',
      headers: { 'x-action-forwarded': '1', 'next-action': 'abc', cookie: 'jesus_session=t' },
      body: '["a"]',
    });
    expect(await response.text()).toBe('{"ok":true}');
    const request = seen[0];
    expect(request?.url).toBe('https://jesus.invalid/entrar/?x=1');
    expect(request?.method).toBe('POST');
    expect(request?.redirect).toBe('manual');
    expect(request?.headers.get('next-action')).toBe('abc');
    expect(request?.headers.get('cookie')).toBe('jesus_session=t');
    expect(await request?.text()).toBe('["a"]');
  });
});

describe('ambiente do servidor da interface', () => {
  it('vem da configuração recebida por mensagem, com https e telemetria desligada', () => {
    const env = serverEnv(CONFIG, { trailingSlash: true, compress: false });
    expect(env).toEqual({
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      JESUS_HTTPS: '1',
      JESUS_DATA_DIR: '/dados/jesus',
      __NEXT_PRIVATE_STANDALONE_CONFIG: '{"trailingSlash":true,"compress":false}',
      __NEXT_PRIVATE_ORIGIN: 'https://jesus.invalid',
    });
  });
});
