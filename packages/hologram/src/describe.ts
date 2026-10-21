import type { HologramSnapshot, HologramState, SatelliteAccess, Taint } from './model';
import { contextRatio, spendLevel } from './visual';

/**
 * Tudo o que o holograma mostra também existe em texto (docs/08-holograma.md, seção 8.6).
 * Estes textos aparecem no painel e podem ser lidos por leitores de tela.
 */

export const stateLabels: Record<HologramState, string> = {
  idle: 'Ocioso',
  listening: 'Ouvindo',
  thinking: 'Pensando',
  speaking: 'Falando',
  executing: 'Executando',
  awaiting: 'Aguardando você',
  blocked: 'Bloqueado',
  compacting: 'Compactando',
  offline: 'Offline',
};

export const accessLabels: Record<SatelliteAccess, string> = {
  read: 'só leitura',
  read_write: 'leitura e escrita',
};

export const taintLabels: Record<Taint, string> = {
  clean: 'tarefa limpa',
  tainted: 'tarefa contaminada (leu conteúdo externo)',
  suspicious: 'tarefa suspeita (possível injeção; saídas bloqueadas)',
};

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${integer.format(tokens / 1_000_000)} mi`;
  if (tokens >= 1_000) return `${integer.format(tokens / 1_000)} mil`;
  return integer.format(tokens);
}

export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

export function formatUsd(value: number): string {
  return currency.format(value);
}

/** Linhas de texto equivalentes ao que o holograma está mostrando. */
export function describeSnapshot(snapshot: HologramSnapshot): string[] {
  const lines: string[] = [];
  lines.push(`Estado: ${stateLabels[snapshot.state]}.`);

  const ratio = contextRatio(snapshot.context);
  lines.push(
    `Contexto: ${formatPercent(ratio)} em uso (${formatTokens(snapshot.context.usedTokens)} de ${formatTokens(
      snapshot.context.limitTokens,
    )} tokens).`,
  );

  if (snapshot.satellites.length === 0) {
    lines.push('Contas conectadas: nenhuma.');
  } else {
    const accounts = snapshot.satellites.map((s) => `${s.label} (${accessLabels[s.access]})`).join(', ');
    lines.push(`Contas conectadas: ${accounts}.`);
  }

  const level = spendLevel(snapshot.spend);
  const spendText = `Gasto hoje: ${formatUsd(snapshot.spend.todayUsd)} de ${formatUsd(snapshot.spend.limitUsd)}`;
  if (level === 'exceeded') lines.push(`${spendText}. Limite atingido: tarefas paradas.`);
  else if (level === 'warning') lines.push(`${spendText}. Atenção: acima de 80% do limite.`);
  else lines.push(`${spendText}.`);

  if (snapshot.taint !== 'clean') lines.push(`Atenção: ${taintLabels[snapshot.taint]}.`);
  if (snapshot.subagents > 0) {
    lines.push(
      snapshot.subagents === 1
        ? '1 subagente trabalhando em paralelo.'
        : `${snapshot.subagents} subagentes trabalhando em paralelo.`,
    );
  }
  if (snapshot.memoryCount > 0) {
    lines.push(
      snapshot.memoryCount === 1 ? '1 memória de longo prazo.' : `${integer.format(snapshot.memoryCount)} memórias de longo prazo.`,
    );
  }
  if (snapshot.deviceCode !== null) {
    lines.push(`Login em andamento: digite o código ${snapshot.deviceCode} na página oficial.`);
  }
  return lines;
}
