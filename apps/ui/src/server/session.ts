import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sessão da tela de entrada (decisão 0016). Depois do desbloqueio, o navegador (no app, a janela do Electron)
 * recebe um cookie com um token aleatório; o servidor guarda só o SHA-256 do token. Bloquear apaga a sessão.
 */

export const SESSION_COOKIE = 'jesus_session';
const TOKEN_BYTES = 32;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newSessionToken(random: (n: number) => Uint8Array = (n) => new Uint8Array(randomBytes(n))): {
  token: string;
  tokenHash: string;
} {
  const token = Buffer.from(random(TOKEN_BYTES)).toString('base64url');
  if (!TOKEN.test(token)) throw new RangeError('token de sessão inválido');
  return { token, tokenHash: hashSessionToken(token) };
}

/** Confere o token do cookie com o hash guardado, em tempo constante. Falha fechada para qualquer formato estranho. */
export function sessionMatches(token: string | undefined, tokenHash: string | null): boolean {
  if (token === undefined || tokenHash === null || !TOKEN.test(token)) return false;
  const a = Buffer.from(hashSessionToken(token), 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  return a.length === b.length && b.length === 32 && timingSafeEqual(a, b);
}

/** Atributos do cookie: inacessível ao JavaScript da página, só no próprio site, `Secure` quando o app usa https. */
export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: 'strict' as const, path: '/', secure };
}
