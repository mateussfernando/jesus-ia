import { describe, expect, it } from 'vitest';
import {
  DATA_KEY_BYTES,
  FieldDecryptError,
  createKeyRing,
  fieldAad,
  generateDataKey,
  openField,
  openFieldText,
  sealField,
  sealedKeyId,
} from './field';
import type { FieldContext } from './field';

const ctx: FieldContext = { table: 'memories', column: 'content_sealed', rowId: '7d1f6a2e-0000-4000-8000-000000000001' };

describe('sealField e openField', () => {
  it('cifra e abre texto em UTF-8', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    const sealed = sealField('Consulta no cardiologista às 15h, sexta 🫀', ring, ctx);
    expect(openFieldText(sealed, ring, ctx)).toBe('Consulta no cardiologista às 15h, sexta 🫀');
  });

  it('usa um nonce novo a cada valor: o mesmo texto cifra diferente', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    const a = sealField('igual', ring, ctx);
    const b = sealField('igual', ring, ctx);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('grava versão, id da chave, nonce e tag (15 + n + 16 bytes)', () => {
    const ring = createKeyRing([generateDataKey(258)], 258);
    const sealed = sealField(new Uint8Array([1, 2, 3]), ring, ctx);
    expect(sealed).toHaveLength(15 + 3 + 16);
    expect(sealed[0]).toBe(1);
    expect(sealedKeyId(sealed)).toBe(258);
  });

  it('não abre em outra linha, coluna ou tabela (dado autenticado)', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    const sealed = sealField('segredo', ring, ctx);
    expect(() => openField(sealed, ring, { ...ctx, rowId: 'outra' })).toThrow(FieldDecryptError);
    expect(() => openField(sealed, ring, { ...ctx, column: 'title' })).toThrow(FieldDecryptError);
    expect(() => openField(sealed, ring, { ...ctx, table: 'messages' })).toThrow(FieldDecryptError);
  });

  it('detecta adulteração em qualquer byte', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    const sealed = sealField('valor importante', ring, ctx);
    for (let i = 0; i < sealed.length; i++) {
      const tampered = new Uint8Array(sealed);
      tampered[i] = (tampered[i] ?? 0) ^ 0x01;
      expect(() => openField(tampered, ring, ctx), `byte ${String(i)}`).toThrow(FieldDecryptError);
    }
  });

  it('recusa valor truncado, versão desconhecida e chave que não está no chaveiro', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    const sealed = sealField('x', ring, ctx);
    expect(() => openField(sealed.subarray(0, 20), ring, ctx)).toThrow(FieldDecryptError);
    const v2 = new Uint8Array(sealed);
    v2[0] = 2;
    expect(() => openField(v2, ring, ctx)).toThrow(FieldDecryptError);
    const other = createKeyRing([generateDataKey(2)], 2);
    expect(() => openField(sealed, other, ctx)).toThrow(FieldDecryptError);
  });

  it('a chave antiga continua abrindo os dados antigos depois da troca', () => {
    const k1 = generateDataKey(1);
    const k2 = generateDataKey(2);
    const old = sealField('antigo', createKeyRing([k1], 1), ctx);
    const ring = createKeyRing([k1, k2], 2);
    const fresh = sealField('novo', ring, ctx);
    expect(sealedKeyId(fresh)).toBe(2);
    expect(openFieldText(old, ring, ctx)).toBe('antigo');
    expect(openFieldText(fresh, ring, ctx)).toBe('novo');
  });

  it('abre valores de tamanhos variados (propriedade)', () => {
    const ring = createKeyRing([generateDataKey(9)], 9);
    for (const size of [0, 1, 15, 16, 17, 255, 4096]) {
      const plain = new Uint8Array(size).map((_, i) => (i * 31 + size) & 0xff);
      expect(Buffer.from(openField(sealField(plain, ring, ctx), ring, ctx)).equals(Buffer.from(plain))).toBe(true);
    }
  });

  it('devolve exatamente o texto cifrado, com o U+FEFF (BOM) do começo', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    for (const text of ['\uFEFFconteúdo importado do Bloco de Notas', '\uFEFF', 'meio \uFEFF fim', '']) {
      expect(openFieldText(sealField(text, ring, ctx), ring, ctx)).toBe(text);
    }
  });

  it('recusa texto com surrogate sozinho em vez de trocar por U+FFFD', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    expect(() => sealField('abc\uD83D', ring, ctx)).toThrow(RangeError);
    expect(() => sealField('\uDE00abc', ring, ctx)).toThrow(RangeError);
    expect(openFieldText(sealField('abc 😀', ring, ctx), ring, ctx)).toBe('abc 😀');
  });

  it('texto inválido em UTF-8 não vira texto com caracteres trocados', () => {
    const ring = createKeyRing([generateDataKey(1)], 1);
    const sealed = sealField(new Uint8Array([0xff, 0xfe]), ring, ctx);
    expect(() => openFieldText(sealed, ring, ctx)).toThrow(FieldDecryptError);
  });
});

describe('chaves e contexto', () => {
  it('gera chaves de 32 bytes e recusa ids fora da faixa', () => {
    expect(generateDataKey(1).bytes).toHaveLength(DATA_KEY_BYTES);
    expect(() => generateDataKey(0)).toThrow(RangeError);
    expect(() => generateDataKey(65_536)).toThrow(RangeError);
  });

  it('o chaveiro recusa ids repetidos, chave curta e chave atual ausente', () => {
    const k = generateDataKey(1);
    expect(() => createKeyRing([k, k], 1)).toThrow(RangeError);
    expect(() => createKeyRing([{ id: 1, bytes: new Uint8Array(16) }], 1)).toThrow(RangeError);
    expect(() => createKeyRing([k], 2)).toThrow(RangeError);
  });

  it('o dado autenticado não é ambíguo e exige as três partes', () => {
    const a = new TextDecoder().decode(fieldAad({ table: 'a:b', column: 'c', rowId: 'd' }));
    const b = new TextDecoder().decode(fieldAad({ table: 'a', column: 'b:c', rowId: 'd' }));
    expect(a).not.toBe(b);
    expect(() => fieldAad({ table: '', column: 'c', rowId: 'd' })).toThrow(RangeError);
  });
});
