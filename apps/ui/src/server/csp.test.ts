import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce, securityHeaders } from './csp';

describe('CSP com nonce', () => {
  it('gera nonces de 144 bits, diferentes a cada pedido', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(a).not.toBe(b);
  });

  it('em produção: sem unsafe-inline nem unsafe-eval para scripts, com strict-dynamic e o nonce', () => {
    const csp = buildCsp('AAAAAAAAAAAAAAAAAAAAAAAA', { dev: false });
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).toBe("script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAAAA' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self';");
  });

  it('em desenvolvimento libera só o eval do React e o WebSocket local do recarregamento', () => {
    const csp = buildCsp('AAAAAAAAAAAAAAAAAAAAAAAA', { dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws://127.0.0.1:*');
    expect(csp).not.toContain('unsafe-inline');
  });

  it('recusa nonce fora do formato (nada de injetar diretivas pelo nonce)', () => {
    expect(() => buildCsp("x'; script-src *", { dev: false })).toThrow(RangeError);
    expect(() => buildCsp('', { dev: false })).toThrow(RangeError);
  });

  it('manda os cabeçalhos de proteção básicos', () => {
    expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(securityHeaders['X-Frame-Options']).toBe('DENY');
    expect(securityHeaders['Referrer-Policy']).toBe('no-referrer');
  });
});
