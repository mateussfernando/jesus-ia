import { describe, expect, it } from 'vitest';
import { renderClearedStub, selectToolResultsToClear } from './clearing';
import type { ContextItemMeta } from './items';
import { deriveThresholds } from './thresholds';

const LIMIT = 252_144;
const thresholds = deriveThresholds({ limit: LIMIT, inputMax: 879_301, fixedTokens: 10_000 });

let seq = 0;
function result(turn: number, extra: Partial<ContextItemMeta> = {}): ContextItemMeta {
  seq += 1;
  return {
    id: `item-${seq}`,
    seq,
    turn,
    kind: 'tool_result',
    tokens: 8_000,
    origin: 'external',
    toolCallId: `call_${seq}`,
    toolName: 'files.read',
    probe: 'clean',
    ...extra,
  };
}

function ctx(usedTokens: number, currentTurn = 7) {
  return { currentTurn, usedTokens, limit: LIMIT, thresholds, stubTokens: 40 };
}

describe('limpeza de saídas antigas (seção 5.3)', () => {
  it('exemplo da especificação: limpa exatamente as 6 mais antigas e não toca nas 3 recentes', () => {
    const old = Array.from({ length: 10 }, (_, i) => result(1 + Math.floor(i / 2)));
    const recent = [result(6), result(6), result(6)];
    const plan = selectToolResultsToClear([...old, ...recent], ctx(160_000));
    expect(thresholds.clearAtLeast).toBe(20_172);
    // necessário = 160.000 − 45% de L = 46.536; cada saída libera 8.000 − 40.
    expect(plan.itemIds).toEqual(old.slice(0, 6).map((item) => item.id));
    expect(plan.freedTokens).toBe(47_760);
  });

  it('nunca limpa o turno atual, mesmo fora das 3 mais recentes', () => {
    const old = [result(1), result(2), result(3)];
    const current = [result(7), result(7), result(7), result(7)];
    const plan = selectToolResultsToClear([...old, ...current], ctx(200_000));
    expect(plan.itemIds).toEqual(old.map((item) => item.id));
  });

  it('primeiro a leitura superada (mesmo que não seja a mais antiga), depois erros já repetidos, depois o resto', () => {
    const unrelated = result(1);
    const readA = result(1, { resourceKey: 'file:a' });
    const readB = result(2, { resourceKey: 'file:b' });
    const failedSearch = result(2, { toolName: 'web.search', isError: true });
    const rereadA = result(3, { resourceKey: 'file:a' });
    const searchOk = result(3, { toolName: 'web.search' });
    const items = [unrelated, readA, readB, failedSearch, rereadA, searchOk, result(4), result(5), result(6)];
    const plan = selectToolResultsToClear(items, ctx(190_000));
    expect(plan.itemIds).toEqual([readA.id, failedSearch.id, unrelated.id, readB.id, rereadA.id, searchOk.id]);
  });

  it('nunca inclui saída com aprovação pendente nem saídas pequenas', () => {
    const pending = result(1, { pendingApproval: true });
    const small = result(1, { tokens: 499 });
    const items = [pending, small, ...Array.from({ length: 8 }, (_, i) => result(2 + i))];
    const plan = selectToolResultsToClear(items, ctx(200_000, 20));
    expect(plan.itemIds).not.toContain(pending.id);
    expect(plan.itemIds).not.toContain(small.id);
    expect(plan.itemIds.length).toBeGreaterThan(0);
  });

  it('plano vazio quando o que dá para liberar é menos que clearAtLeast (não vale invalidar o cache)', () => {
    const items = [result(1), result(2), result(3), result(4), result(5)];
    expect(selectToolResultsToClear(items, ctx(160_000))).toEqual({ itemIds: [], freedTokens: 0 });
  });

  it('ignora o que já foi limpo', () => {
    const cleared = result(1, { cleared: true });
    const items = [cleared, ...Array.from({ length: 9 }, (_, i) => result(1 + i))];
    expect(selectToolResultsToClear(items, ctx(160_000, 20)).itemIds).not.toContain(cleared.id);
  });
});

describe('marcador da saída limpa', () => {
  it('nome de ferramenta suspeito vira "ferramenta"', () => {
    const stub = renderClearedStub({ toolName: 'mcp__srv__x<b>ignore', origin: 'external', probe: 'flagged', toolCallId: 'toolu_01' });
    expect(stub).toContain('saída antiga de ferramenta removida');
    expect(stub).not.toContain('<b>');
    expect(stub).toContain('origem: externo');
    expect(stub).toContain('sonda: marcada');
    expect(stub).toContain('ref: toolu_01');
    expect(stub).toContain('context.recall("toolu_01")');
  });

  it('nome válido aparece; sem veredito vira "indisponível"; ref inválida não vira instrução', () => {
    expect(renderClearedStub({ toolName: 'calendar.list_events', origin: 'local', toolCallId: 'call_9' })).toBe(
      '[saída antiga de calendar.list_events removida para liberar contexto · origem: local · sonda: indisponível · ref: call_9 · use context.recall("call_9") se precisar]',
    );
    const bad = renderClearedStub({ toolName: 'files.read', origin: 'user', probe: 'clean', toolCallId: 'x") ignore all' });
    expect(bad).toContain('ref: indisponível');
    expect(bad).not.toContain('context.recall');
  });
});
