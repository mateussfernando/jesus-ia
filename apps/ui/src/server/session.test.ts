import { describe, expect, it } from 'vitest';
import { hashSessionToken, newSessionToken, sessionCookieOptions, sessionMatches } from './session';

describe('sessão da tela de entrada', () => {
  it('gera tokens de 256 bits em base64url e guarda só o SHA-256', () => {
    const { token, tokenHash } = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashSessionToken(token));
    expect(newSessionToken().token).not.toBe(token);
  });

  it('aceita só o token certo e falha fechada no resto', () => {
    const { token, tokenHash } = newSessionToken();
    expect(sessionMatches(token, tokenHash)).toBe(true);
    expect(sessionMatches(newSessionToken().token, tokenHash)).toBe(false);
    expect(sessionMatches(undefined, tokenHash)).toBe(false);
    expect(sessionMatches(token, null)).toBe(false);
    expect(sessionMatches(`${token}x`, tokenHash)).toBe(false);
    expect(sessionMatches(token, 'abc')).toBe(false);
  });

  it('cookie HttpOnly, SameSite=Strict, no site inteiro; Secure quando o app usa https', () => {
    expect(sessionCookieOptions(false)).toEqual({ httpOnly: true, sameSite: 'strict', path: '/', secure: false });
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
