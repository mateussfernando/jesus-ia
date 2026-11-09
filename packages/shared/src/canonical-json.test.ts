import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson } from './canonical-json';

describe('JSON canônico', () => {
  it('vetor do rascunho: chaves em ordem, sem espaços, "é" em NFC mesmo vindo decomposto', () => {
    expect(canonicalJson({ b: 1, a: [2, 'é'] })).toBe('{"a":[2,"é"],"b":1}');
    expect(canonicalJson({ b: 1, a: [2, 'e\u0301'] })).toBe('{"a":[2,"é"],"b":1}');
  });

  it('fração, NaN, infinito e inteiro inseguro lançam erro', () => {
    for (const x of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => canonicalJson({ x })).toThrow(CanonicalJsonError);
    }
    expect(canonicalJson({ x: Number.MAX_SAFE_INTEGER, y: -0 })).toBe(`{"x":${String(Number.MAX_SAFE_INTEGER)},"y":0}`);
  });

  it('o hash é igual com as chaves em ordem diferente (a interface assina, o Executor confere)', () => {
    const card = { tool: 'file.read', params: { path: 'C:\\notas.txt', limit: 10 }, level: 'medium' };
    const sameCard = { level: 'medium', params: { limit: 10, path: 'C:\\notas.txt' }, tool: 'file.read' };
    const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
    expect(sha(card)).toBe(sha(sameCard));
  });

  it('ordem por ponto de código, não por unidade UTF-16', () => {
    // Em UTF-16, o emoji (par substituto, 0xD83D…) viria antes de U+FF61; por ponto de código, vem depois.
    expect(canonicalJson({ '\u{1F600}': 1, '\uFF61': 2, a: 3 })).toBe('{"a":3,"\uFF61":2,"\u{1F600}":1}');
  });

  it('undefined: fica de fora no objeto, lança erro no array e sozinho; null fica', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalJson([1, undefined])).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
  });

  it('escapa como o JSON.stringify (aspas, barra, controle, substituto solto)', () => {
    expect(canonicalJson('a"b\\c\n\u0001\uD800')).toBe(JSON.stringify('a"b\\c\n\u0001\uD800'));
  });

  it('recusa o que não é JSON simples: bigint, função, data, mapa, classe, ciclo, chaves iguais depois da NFC', () => {
    class Coisa {
      readonly x = 1;
    }
    const cycle: Record<string, unknown> = {};
    cycle['eu'] = cycle;
    for (const value of [1n, () => 1, new Date(0), new Map(), new Coisa(), new Uint8Array(1), cycle, Symbol('s')]) {
      expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError);
    }
    expect(() => canonicalJson({ 'e\u0301': 1, é: 2 })).toThrow(CanonicalJsonError);
  });

  it('o mesmo objeto em dois ramos não é ciclo', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('objeto sem protótipo é aceito; profundidade tem limite', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { z: true, a: false });
    expect(canonicalJson(bare)).toBe('{"a":false,"z":true}');
    let deep: unknown = 1;
    for (let i = 0; i < 70; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(CanonicalJsonError);
  });
});
