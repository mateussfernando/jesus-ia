import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_CHARS,
  formatRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
  randomBytes,
  randomInt,
} from './random';

/** Fonte de bytes previsível para testes: repete a sequência dada. */
function cycling(values: readonly number[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let k = 0; k < n; k++) out[k] = values[i++ % values.length] ?? 0;
    return out;
  };
}

describe('randomBytes', () => {
  it('devolve o tamanho pedido e valores diferentes a cada chamada', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(Buffer.from(randomBytes(32)).equals(Buffer.from(randomBytes(32)))).toBe(false);
  });

  it('recusa tamanhos inválidos', () => {
    expect(() => randomBytes(-1)).toThrow(RangeError);
    expect(() => randomBytes(1.5)).toThrow(RangeError);
  });
});

describe('randomInt', () => {
  it('fica sempre dentro de [0, max)', () => {
    for (let i = 0; i < 200; i++) {
      const v = randomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('rejeita os valores do fim da faixa (sem viés de módulo)', () => {
    // max = 3: limite = floor(2³²/3)·3 = 4.294.967.295. O valor 0xFFFFFFFF fica fora e é descartado.
    const source = cycling([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 5]);
    expect(randomInt(3, source)).toBe(5 % 3);
  });
});

describe('códigos de recuperação', () => {
  it('têm 20 caracteres de Crockford em 4 grupos de 5', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    expect(code.replace(/-/g, '')).toHaveLength(RECOVERY_CODE_CHARS);
  });

  it('são determinísticos com a fonte injetada', () => {
    const code = generateRecoveryCode(cycling([0, 0, 0, 1]));
    expect(code).toBe('11111-11111-11111-11111');
  });

  it('aceitam o código digitado com minúsculas, espaços e trocas comuns', () => {
    expect(normalizeRecoveryCode('abcde fghjk-mnpqr stvwx')).toBe('ABCDEFGHJKMNPQRSTVWX');
    // I e L viram 1; O vira 0 (alfabeto de Crockford).
    expect(normalizeRecoveryCode('IIIII-LLLLL-OOOOO-00000')).toBe('11111111110000000000');
    expect(formatRecoveryCode('abcdefghjkmnpqrstvwx')).toBe('ABCDE-FGHJK-MNPQR-STVWX');
  });

  it('recusam tamanho errado e caracteres fora do alfabeto', () => {
    expect(normalizeRecoveryCode('ABCDE-FGHJK-MNPQR')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-FGHJK-MNPQR-STVWU')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-FGHJK-MNPQR-STVW!')).toBeNull();
    expect(() => formatRecoveryCode('curto')).toThrow(RangeError);
  });
});
