import { describe, expect, it } from 'vitest';
import {
  BCRYPT_MAX_BYTES,
  DEFAULT_PASSWORD_COST,
  PasswordCharError,
  PasswordLengthError,
  hasUnsafePasswordChar,
  hashCost,
  hashPassword,
  isBcryptHash,
  needsRehash,
  passwordByteLength,
  verifyPassword,
} from './password';

// Custo 4 (o mínimo do algoritmo) deixa os testes rápidos; o custo padrão é testado uma vez.
const FAST = { cost: 4 };

describe('hashPassword e verifyPassword', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const hash = await hashPassword('cavalo correto bateria grampo', FAST);
    expect(isBcryptHash(hash)).toBe(true);
    expect(await verifyPassword('cavalo correto bateria grampo', hash)).toBe(true);
    expect(await verifyPassword('cavalo correto bateria grampO', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('usa sal aleatório: a mesma senha gera hashes diferentes', async () => {
    const a = await hashPassword('mesma senha de teste', FAST);
    const b = await hashPassword('mesma senha de teste', FAST);
    expect(a).not.toBe(b);
  });

  it('usa custo 12 por padrão', async () => {
    expect(DEFAULT_PASSWORD_COST).toBe(12);
    const hash = await hashPassword('senha com custo padrão');
    expect(hash.startsWith('$2b$12$')).toBe(true);
    expect(hashCost(hash)).toBe(12);
  });

  it('normaliza para NFC: "é" composto e decomposto valem igual', async () => {
    const composed = 'café com pão';
    const decomposed = 'café com pão';
    expect(composed).not.toBe(decomposed);
    const hash = await hashPassword(decomposed, FAST);
    expect(await verifyPassword(composed, hash)).toBe(true);
  });

  it('recusa senha vazia e acima de 72 bytes, sem cortar', async () => {
    await expect(hashPassword('', FAST)).rejects.toBeInstanceOf(PasswordLengthError);
    const longAscii = 'a'.repeat(BCRYPT_MAX_BYTES + 1);
    await expect(hashPassword(longAscii, FAST)).rejects.toMatchObject({ reason: 'too_long', bytes: 73 });
    // 36 "ç" = 72 bytes (2 bytes cada): cabe; 37 não cabe.
    expect(passwordByteLength('ç'.repeat(36))).toBe(72);
    await expect(hashPassword('ç'.repeat(36), FAST)).resolves.toMatch(/^\$2b\$04\$/);
    await expect(hashPassword('ç'.repeat(37), FAST)).rejects.toMatchObject({ reason: 'too_long', bytes: 74 });
  });

  it('não aceita a senha certa seguida de qualquer coisa além de 72 bytes', async () => {
    const exact = 'x'.repeat(BCRYPT_MAX_BYTES);
    const hash = await hashPassword(exact, FAST);
    expect(await verifyPassword(exact, hash)).toBe(true);
    // O bcrypt puro aceitaria (ele ignora o que passa de 72 bytes); o Jesus não.
    expect(await verifyPassword(`${exact}a mais`, hash)).toBe(false);
  });

  it('recusa U+0000: o bcrypt repete a chave em ciclo e "senha\\0senha" passaria', async () => {
    const password = 'cavalo correto bateria grampo';
    const hash = await hashPassword(password, FAST);
    expect(await verifyPassword(`${password}\u0000${password}`, hash)).toBe(false);
    expect(await verifyPassword(`${password}\u0000`, hash)).toBe(false);
    // 71 bytes + U+0000 = 72 bytes: dentro do limite, mas a mesma chave da senha de 71 bytes.
    const p71 = 'y'.repeat(BCRYPT_MAX_BYTES - 1);
    const h71 = await hashPassword(p71, FAST);
    expect(await verifyPassword(`${p71}\u0000`, h71)).toBe(false);
    expect(await verifyPassword(p71, h71)).toBe(true);
    await expect(hashPassword('abc\u0000def', FAST)).rejects.toBeInstanceOf(PasswordCharError);
  });

  it('recusa surrogate sozinho e aceita emoji inteiro', async () => {
    expect(hasUnsafePasswordChar('senha \uD83D')).toBe(true);
    expect(hasUnsafePasswordChar('senha \uDE00 fim')).toBe(true);
    expect(hasUnsafePasswordChar('senha 😀 inteira')).toBe(false);
    await expect(hashPassword('senha \uD83D', FAST)).rejects.toBeInstanceOf(PasswordCharError);
    const hash = await hashPassword('senha 😀 inteira', FAST);
    expect(await verifyPassword('senha 😀 inteira', hash)).toBe(true);
    expect(await verifyPassword('senha \uD83D', hash)).toBe(false);
  });

  it('falha fechada com hash malformado', async () => {
    expect(await verifyPassword('qualquer', '')).toBe(false);
    expect(await verifyPassword('qualquer', 'texto puro')).toBe(false);
    expect(await verifyPassword('qualquer', '$2b$12$curto')).toBe(false);
    expect(await verifyPassword('qualquer', '$2b$99$' + 'a'.repeat(53))).toBe(false);
  });

  it('recusa custo fora da faixa do algoritmo', async () => {
    await expect(hashPassword('senha', { cost: 3 })).rejects.toBeInstanceOf(RangeError);
    await expect(hashPassword('senha', { cost: 32 })).rejects.toBeInstanceOf(RangeError);
    await expect(hashPassword('senha', { cost: 10.5 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('needsRehash', () => {
  it('pede refazer quando o custo gravado é menor que o atual ou o hash é inválido', async () => {
    const weak = await hashPassword('senha antiga', FAST);
    expect(needsRehash(weak, 12)).toBe(true);
    expect(needsRehash(weak, 4)).toBe(false);
    expect(needsRehash('não é hash', 12)).toBe(true);
  });
});
