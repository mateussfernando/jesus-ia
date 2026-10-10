import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_CHARS, checkNewPassword, effectivePasswordChars, passwordProblemText } from './policy';

describe('checkNewPassword', () => {
  it('aceita uma frase longa e marca como forte a partir de 15 caracteres', () => {
    const strong = checkNewPassword('cafe forte na varanda');
    expect(strong).toMatchObject({ ok: true, strong: true });
    const ok = checkNewPassword('girassol azul');
    expect(ok).toMatchObject({ ok: true, strong: false, chars: 13 });
  });

  it('recusa menos de 12 caracteres e explica', () => {
    const r = checkNewPassword('curtinha');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain('too_short');
    expect(MIN_PASSWORD_CHARS).toBe(12);
  });

  it('conta espaços repetidos como um e ignora as pontas', () => {
    expect(effectivePasswordChars('  a    b  ')).toBe(3);
    expect(checkNewPassword('abc          def').ok).toBe(false);
  });

  it('recusa acima de 72 bytes (acentos contam 2 bytes) e mostra os dois problemas juntos', () => {
    const r = checkNewPassword('ç'.repeat(40));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.bytes).toBe(80);
      expect(r.problems).toEqual(['too_long', 'repetitive']);
    }
  });

  it('recusa senhas comuns, mesmo com maiúsculas, espaços e pontuação', () => {
    for (const pw of ['123456789012', 'Senha Senha 123', 'minha.senha.123', 'QWERTY123456', 'Jesus Cristo 12']) {
      const r = checkNewPassword(pw);
      expect(r.ok, pw).toBe(false);
      if (!r.ok) expect(r.problems, pw).toContain('common');
    }
  });

  it('recusa repetição e sequência', () => {
    expect(checkNewPassword('aaaaaaaaaaaaaa')).toMatchObject({ ok: false, problems: ['repetitive'] });
    expect(checkNewPassword('abcabcabcabc')).toMatchObject({ ok: false, problems: ['repetitive'] });
    expect(checkNewPassword('abcdefghijklmnop')).toMatchObject({ ok: false, problems: ['sequence'] });
    expect(checkNewPassword('zyxwvutsrqpo')).toMatchObject({ ok: false, problems: ['sequence'] });
    expect(checkNewPassword('3456789012345')).toMatchObject({ ok: false, problems: ['sequence'] });
  });

  it('tem texto em pt-BR para cada problema', () => {
    for (const text of Object.values(passwordProblemText)) expect(text.length).toBeGreaterThan(10);
  });
});
