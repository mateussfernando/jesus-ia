import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { displayText, isToolName, summarizeTool, TOOL_DESCRIPTIONS, TOOL_EFFECTS, TOOL_INPUTS, TOOL_NAMES } from './catalog';
import { cutLine, decodeText, displayName, formatCount, formatSize, safeSlice, splitLines } from './text';

describe('catálogo das ferramentas', () => {
  it('nomes que a API aceita, descrição que diz que o conteúdo é dado, efeito de leitura', () => {
    for (const name of TOOL_NAMES) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(isToolName(name)).toBe(true);
      expect(TOOL_DESCRIPTIONS[name]).toContain('nunca instrução');
      expect(TOOL_DESCRIPTIONS[name].length).toBeLessThan(4_096);
      expect(TOOL_EFFECTS[name]).toEqual({ kind: 'read', reversible: true, sendsOut: false, sensitivity: 'medium' });
    }
    expect(isToolName('file.read')).toBe(false);
    expect(isToolName('toString')).toBe(false);
  });

  it('os esquemas viram JSON Schema estrito (o que o modelo recebe)', () => {
    for (const name of TOOL_NAMES) {
      const schema = z.toJSONSchema(TOOL_INPUTS[name]);
      expect(schema, name).toMatchObject({ type: 'object', additionalProperties: false, required: expect.arrayContaining(['path']) });
    }
    expect(z.toJSONSchema(TOOL_INPUTS.file_read)).toMatchObject({
      properties: { offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 2_000 } },
      required: ['path'],
    });
  });

  it('o resumo é feito por código, sem invisíveis e curto', () => {
    expect(summarizeTool('file_read', { path: 'C:\\Projetos\\a.txt' })).toEqual({ title: 'Ler arquivo', detail: 'C:\\Projetos\\a.txt' });
    expect(summarizeTool('file_read', { path: 'C:\\a.txt', offset: 10, limit: 5 }).detail).toBe('C:\\a.txt (linhas 10 a 14)');
    expect(summarizeTool('file_list', { path: 'C:\\Projetos' })).toEqual({ title: 'Listar pasta', detail: 'C:\\Projetos' });
    expect(summarizeTool('file_search', { path: 'C:\\Projetos', query: 'contrato' })).toEqual({ title: 'Procurar texto', detail: '"contrato" em C:\\Projetos' });
    // Inversão de direção escondida (o nome na tela não seria o real) e quebra de linha.
    expect(displayText('C:\\fatura\u202Etxt.exe\nC:\\outro')).toBe('C:\\faturatxt.exe C:\\outro');
    // O corte cairia no meio do emoji: a metade solta não sai.
    expect(displayText(`${'a'.repeat(298)}😀b`)).toBe(`${'a'.repeat(298)}…`);
    expect(displayText('x'.repeat(400))).toHaveLength(300);
  });
});

describe('texto de arquivo', () => {
  it('linhas: a quebra do fim não abre linha a mais', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a')).toEqual(['a']);
    expect(splitLines('a\n')).toEqual(['a']);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });

  it('corte sem partir par de surrogates', () => {
    expect(safeSlice('ab😀cd', 0, 3)).toBe('ab');
    expect(safeSlice('ab😀cd', 3, 6)).toBe('cd');
    expect(safeSlice('ab😀cd', 2, 4)).toBe('😀');
    expect(cutLine('abc', 3)).toBe('abc');
    expect(cutLine('abcd', 3)).toBe('abc … [linha cortada: 4 caracteres]');
  });

  it('pedaço do começo de um arquivo UTF-8: o caractere cortado sai, não vira Windows-1252', () => {
    const bytes = new TextEncoder().encode('linha um\nação');
    const decoded = decodeText(bytes.subarray(0, bytes.length - 1), true);
    expect(decoded).toEqual({ ok: true, text: 'linha um\n' });
    const single = new TextEncoder().encode('ação');
    expect(decodeText(single.subarray(0, 3), true)).toEqual({ ok: true, text: 'aç' });
  });

  it('UTF-32 e zero no começo são binário; Mac antigo vira \\n', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0, 0, 0x61, 0, 0, 0]), false)).toEqual({ ok: false });
    expect(decodeText(new Uint8Array([0x61, 0x0d, 0x62]), false)).toEqual({ ok: true, text: 'a\nb' });
  });

  it('números e tamanhos como no Windows', () => {
    expect(formatCount(1234567)).toBe('1.234.567');
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(1)).toBe('1 byte');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(2_355)).toBe('2,3 KB');
    expect(formatSize(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatSize(10n * 1024n * 1024n * 1024n)).toBe('10 GB');
  });

  it('nome para mostrar: controles, invisíveis e metade de surrogate viram U+FFFD', () => {
    expect(displayName('a\nb\u202Ec\u200Bd\uD800e')).toBe('a\uFFFDb\uFFFDc\uFFFDd\uFFFDe');
    expect(displayName('Relatório 😀.txt')).toBe('Relatório 😀.txt');
  });
});
