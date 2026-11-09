import { describe, expect, it } from 'vitest';
import { describeSnapshot, formatTokens, stateLabels } from './describe';
import { hologramStates } from './model';
import type { HologramSnapshot } from './model';

const snapshot: HologramSnapshot = {
  state: 'thinking',
  context: { usedTokens: 42_000, limitTokens: 200_000 },
  spend: { todayUsd: 1.2, limitUsd: 5 },
  satellites: [
    { id: 'google', label: 'Google', access: 'read' },
    { id: 'github', label: 'GitHub', access: 'read_write' },
  ],
  pulses: [],
  taint: 'clean',
  subagents: 0,
  memoryCount: 0,
  deviceCode: null,
};

describe('describeSnapshot (tudo o que o holograma mostra também existe em texto)', () => {
  it('descreve estado, contexto, contas e gasto em pt-BR', () => {
    const text = describeSnapshot(snapshot).join('\n');
    expect(text).toContain('Estado: Pensando.');
    expect(text).toContain('21%');
    expect(text).toContain('42 mil de 200 mil tokens');
    expect(text).toContain('Google (só leitura)');
    expect(text).toContain('GitHub (leitura e escrita)');
    expect(text).toMatch(/Gasto hoje: US\$\s?1,20 de US\$\s?5,00\./);
  });

  it('avisa contaminação, orçamento e login', () => {
    const text = describeSnapshot({
      ...snapshot,
      taint: 'tainted',
      spend: { todayUsd: 4.5, limitUsd: 5 },
      deviceCode: 'WDJB-MJHT',
      subagents: 2,
      memoryCount: 1,
    }).join('\n');
    expect(text).toContain('contaminada');
    expect(text).toContain('acima de 80%');
    expect(text).toContain('WDJB-MJHT');
    expect(text).toContain('2 subagentes');
    expect(text).toContain('1 memória');
  });

  it('avisa quando o limite de gasto foi atingido', () => {
    expect(describeSnapshot({ ...snapshot, spend: { todayUsd: 5, limitUsd: 5 } }).join(' ')).toContain('Limite atingido');
  });

  it('não diz nada de contaminação numa tarefa limpa', () => {
    expect(describeSnapshot(snapshot).join(' ')).not.toContain('Atenção');
  });

  it('tem rótulo para todos os estados', () => {
    for (const state of hologramStates) expect(stateLabels[state].length).toBeGreaterThan(0);
  });

  it('formata tokens', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(128_000)).toBe('128 mil');
    expect(formatTokens(1_000_000)).toBe('1 mi');
  });
});
