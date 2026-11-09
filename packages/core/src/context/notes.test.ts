import { describe, expect, it } from 'vitest';
import { renderHarnessNote } from './notes';
import { deriveThresholds } from './thresholds';

const LIMIT = 252_144;
const thresholds = deriveThresholds({ limit: LIMIT, inputMax: 879_301, fixedTokens: 10_000 });

describe('notas do harness (seção 5.4)', () => {
  it('pressão de memória como mensagem de sistema', () => {
    const note = renderHarnessNote({
      kind: 'memory_pressure',
      usedTokens: Math.ceil(0.75 * LIMIT),
      limit: LIMIT,
      thresholds,
      channel: 'system_message',
      nonce: 'ignored',
    });
    expect(note).toEqual({
      role: 'system',
      text: 'Contexto em 75% do limite; compacta em 85%. Se houver algo que valha lembrar a longo prazo, você pode propor com memory.save.',
    });
  });

  it('consciência de contexto como bloco marcado com o nonce da sessão', () => {
    const note = renderHarnessNote({
      kind: 'context_status',
      usedTokens: Math.ceil(0.62 * LIMIT),
      limit: LIMIT,
      thresholds,
      channel: 'tagged_text',
      nonce: 'n0nce_ABC',
    });
    expect(note).toEqual({ role: 'tagged_text', text: '<nota_do_jesus n="n0nce_ABC">contexto: 62% de 252 mil; compacta em 85%</nota_do_jesus>' });
  });

  it('nunca usa o papel do usuário e recusa nonce que poderia forjar a marcação', () => {
    for (const channel of ['system_message', 'tagged_text'] as const) {
      const note = renderHarnessNote({ kind: 'context_status', usedTokens: 1_000, limit: LIMIT, thresholds, channel, nonce: 'abcdefgh' });
      expect(note.role).not.toBe('user');
    }
    expect(() =>
      renderHarnessNote({ kind: 'context_status', usedTokens: 1, limit: LIMIT, thresholds, channel: 'tagged_text', nonce: '"><x y="' }),
    ).toThrow();
  });
});
