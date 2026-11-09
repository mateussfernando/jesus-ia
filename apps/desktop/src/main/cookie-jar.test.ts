import { describe, expect, it } from 'vitest';
import { CookieJar, defaultCookiePath, parseSetCookie, pathMatches } from './cookie-jar';

const APP = 'https://jesus.invalid';
const SESSION = 'jesus_session=abc123; Path=/; HttpOnly; SameSite=Strict; Secure';

function jarAt(start = 1_000_000) {
  let now = start;
  const jar = new CookieJar(() => now);
  return { jar, advance: (ms: number) => (now += ms) };
}

describe('pote de cookies do app', () => {
  it('guarda o cookie da sessão e manda de volta em qualquer página do app', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/entrar/`, [SESSION]);
    expect(jar.headerFor(`${APP}/`)).toBe('jesus_session=abc123');
    expect(jar.headerFor(`${APP}/cenarios/`)).toBe('jesus_session=abc123');
  });

  it('Max-Age ou Expires no passado apagam; Max-Age vence Expires', () => {
    const { jar, advance } = jarAt();
    jar.storeFromResponse(`${APP}/`, [SESSION]);
    jar.storeFromResponse(`${APP}/`, ['jesus_session=; Path=/; Max-Age=0']);
    expect(jar.headerFor(`${APP}/`)).toBeNull();

    jar.storeFromResponse(`${APP}/`, [SESSION]);
    jar.storeFromResponse(`${APP}/`, ['jesus_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
    expect(jar.headerFor(`${APP}/`)).toBeNull();

    // Max-Age de 60 s vence um Expires já vencido.
    jar.storeFromResponse(`${APP}/`, ['a=1; Path=/; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
    expect(jar.headerFor(`${APP}/`)).toBe('a=1');
    advance(61_000);
    expect(jar.headerFor(`${APP}/`)).toBeNull();
    expect(jar.size).toBe(0);
  });

  it('respeita o Path e ordena os caminhos mais longos primeiro', () => {
    const { jar, advance } = jarAt();
    jar.storeFromResponse(`${APP}/`, ['geral=1; Path=/']);
    advance(1);
    jar.storeFromResponse(`${APP}/`, ['lab=2; Path=/cenarios']);
    expect(jar.headerFor(`${APP}/cenarios/`)).toBe('lab=2; geral=1');
    expect(jar.headerFor(`${APP}/cenariosx`)).toBe('geral=1');
    expect(jar.headerFor(`${APP}/entrar/`)).toBe('geral=1');
  });

  it('cookie sem Path usa o diretório do pedido', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/entrar/form`, ['x=1']);
    expect(jar.headerFor(`${APP}/entrar/outra`)).toBe('x=1');
    expect(jar.headerFor(`${APP}/`)).toBeNull();
  });

  it('substitui pelo mesmo nome e caminho', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/`, ['jesus_session=velho; Path=/']);
    jar.storeFromResponse(`${APP}/`, ['jesus_session=novo; Path=/']);
    expect(jar.headerFor(`${APP}/`)).toBe('jesus_session=novo');
    expect(jar.size).toBe(1);
  });

  it('ignora cookie e pedido de outro host, de http ou com usuário na URL', () => {
    const { jar } = jarAt();
    jar.storeFromResponse('https://atacante.example/', [SESSION]);
    jar.storeFromResponse('http://jesus.invalid/', [SESSION]);
    jar.storeFromResponse('https://u@jesus.invalid/', [SESSION]);
    expect(jar.size).toBe(0);
    jar.storeFromResponse(`${APP}/`, [SESSION]);
    expect(jar.headerFor('https://atacante.example/')).toBeNull();
    expect(jar.headerFor('http://jesus.invalid/')).toBeNull();
    expect(jar.headerFor('https://jesus.invalid.evil/')).toBeNull();
    expect(jar.headerFor('nada disso é URL')).toBeNull();
  });

  it('recusa Domain de outro host e aceita o próprio', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/`, ['a=1; Path=/; Domain=atacante.example', 'b=2; Path=/; Domain=.jesus.invalid']);
    expect(jar.headerFor(`${APP}/`)).toBe('b=2');
  });

  it('aplica as regras dos prefixos __Host- e __Secure-', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/`, [
      '__Host-a=1; Path=/',
      '__Host-b=2; Secure; Path=/x',
      '__Host-c=3; Secure; Path=/; Domain=jesus.invalid',
      '__Host-ok=4; Secure; Path=/',
      '__Secure-d=5',
      '__Secure-ok=6; Secure; Path=/',
    ]);
    expect(jar.headerFor(`${APP}/`)).toBe('__Host-ok=4; __Secure-ok=6');
  });

  it('Set-Cookie malformado não derruba nada', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/`, ['', '=sem-nome', 'sem-igual', 'nome com espaço=1', 'ctl=a\u0001b', SESSION, `big=${'x'.repeat(5000)}`]);
    expect(jar.headerFor(`${APP}/`)).toBe('jesus_session=abc123');
  });

  it('guarda os atributos para quem quiser conferir', () => {
    const parsed = parseSetCookie(SESSION, '/', 0);
    expect(parsed).toMatchObject({
      kind: 'store',
      cookie: { name: 'jesus_session', path: '/', secure: true, httpOnly: true, sameSite: 'strict', expiresAt: null },
    });
  });

  it('limpa tudo de uma vez (servidor da interface reiniciou)', () => {
    const { jar } = jarAt();
    jar.storeFromResponse(`${APP}/`, [SESSION, 'b=2; Path=/']);
    jar.clear();
    expect(jar.headerFor(`${APP}/`)).toBeNull();
  });

  it('caminho padrão e casamento de caminhos seguem a RFC 6265', () => {
    expect(defaultCookiePath('/')).toBe('/');
    expect(defaultCookiePath('/a')).toBe('/');
    expect(defaultCookiePath('/a/b')).toBe('/a');
    expect(defaultCookiePath('sem-barra')).toBe('/');
    expect(pathMatches('/a/b', '/a')).toBe(true);
    expect(pathMatches('/a/', '/a/')).toBe(true);
    expect(pathMatches('/ab', '/a')).toBe(false);
    expect(pathMatches('/', '/a')).toBe(false);
  });
});
