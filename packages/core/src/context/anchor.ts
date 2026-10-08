import type { ContextItemMeta } from './items';

/**
 * Âncora no uso real (docs/rascunhos/algoritmo-contexto.md, seção 7.2).
 *
 * A entrada que o provedor informou na última resposta é a melhor medida do contexto. Só falta estimar o que entrou
 * depois dela. A âncora só vale para o mesmo modelo (o tokenizador muda com ele), a mesma versão do histórico
 * (limpeza, despejo e compactação incrementam `historyVersion`) e o mesmo conjunto de ferramentas (as definições
 * fazem parte da parte fixa). Fora disso, tudo volta a ser estimado. Lógica pura: sem relógio, rede ou banco.
 */

export interface ContextAnchor {
  /** Modelo da resposta que gerou a âncora. */
  modelKey: string;
  /** Versão do histórico enviada nessa resposta. */
  historyVersion: number;
  /** Hash do conjunto de ferramentas enviado nessa resposta. */
  toolsetHash: string;
  /** Entrada TOTAL informada pelo provedor (uso normalizado, seção 7.5), em tokens. */
  actualInputTokens: number;
  /** Parte fixa estimada (sem k) no envio que gerou a âncora. */
  fixedEstimate: number;
  /** Histórico estimado (sem k) no envio que gerou a âncora. */
  historyEstimate: number;
}

/** O que identifica o contexto atual para comparar com a âncora. */
export interface AnchorKey {
  modelKey: string;
  historyVersion: number;
  toolsetHash: string;
}

export interface ContextUsageInput {
  anchor: ContextAnchor | null;
  current: AnchorKey;
  /** Itens que entraram depois da resposta que gerou a âncora. */
  itemsAfterAnchor: readonly ContextItemMeta[];
  /** Todos os itens do histórico (usados quando a âncora não vale). */
  allItems: readonly ContextItemMeta[];
  /** Parte fixa estimada agora (sem k): sistema, JESUS.md, índice de memória e definições de ferramentas. */
  fixedEstimate: number;
  /** Fator de calibração do estimador (seção 7.4). */
  k: number;
}

export type ContextUsageSource = 'anchored' | 'estimated';

export interface ContextUsage {
  /** U: histórico em uso, sem a parte fixa (vai para `usedTokens`). Inteiro, nunca negativo. */
  usedTokens: number;
  /** Entrada total prevista (parte fixa + histórico). Inteiro, nunca negativo. */
  totalInputTokens: number;
  source: ContextUsageSource;
}

/**
 * Tolerância relativa para o erro de ponto flutuante dos produtos com k (ex.: 1,1 × 1.500 = 1.650,0000000000002).
 * Vale menos de um milionésimo de token na faixa de janelas do projeto (até 2 milhões).
 */
const FLOAT_TOLERANCE = 1e-12;

/** round(x) com meio para cima, sem o erro de ponto flutuante empurrar um ",5" exato para baixo. */
function roundProduct(x: number): number {
  return Math.floor(x + 0.5 + FLOAT_TOLERANCE * Math.max(1, Math.abs(x)));
}

function isNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Contagem de tokens de um item: NaN, infinita ou negativa conta 0 (como no estimador, seção 14). */
function tokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sumTokens(items: readonly ContextItemMeta[]): number {
  let total = 0;
  for (const item of items) total += tokenCount(item.tokens);
  return total;
}

/**
 * A âncora vale ⇔ mesmo `modelKey`, mesma `historyVersion` e mesmo `toolsetHash` (seção 7.2), e números sãos:
 * entrada real finita e positiva, estimativas finitas, não negativas e com soma positiva (senão a proporção da
 * parte fixa não existe). Âncora inválida não é erro: o uso volta a ser estimado.
 */
export function isAnchorValid(anchor: ContextAnchor | null, current: AnchorKey): anchor is ContextAnchor {
  return (
    anchor !== null &&
    anchor.modelKey === current.modelKey &&
    anchor.historyVersion === current.historyVersion &&
    anchor.toolsetHash === current.toolsetHash &&
    Number.isFinite(anchor.actualInputTokens) &&
    anchor.actualInputTokens > 0 &&
    isNonNegative(anchor.fixedEstimate) &&
    isNonNegative(anchor.historyEstimate) &&
    anchor.fixedEstimate + anchor.historyEstimate > 0
  );
}

/**
 * Uso do contexto (seção 7.2).
 *
 * Âncora válida (`source: 'anchored'`):
 *   fixedReal = round(real × F_âncora / (F_âncora + H_âncora))   — a parte fixa real sai da proporção na âncora
 *   total     = real + round(k × (Σ est(depois) + (F − F_âncora)))
 *   usado     = real − fixedReal + round(k × Σ est(depois))
 * Sem âncora válida (`source: 'estimated'`):
 *   total = round(k × (Σ est(todos) + F));  usado = total − round(k × F)
 *
 * Itens limpos ou despejados contam com os tokens atuais (o chamador já os trocou pelos marcadores).
 * `usedTokens` e `totalInputTokens` nunca são negativos. Contagens inválidas (NaN, negativas, infinitas) contam 0;
 * `k` inválido (NaN, infinito, ≤ 0) vale 1, o mesmo de um modelo ainda sem calibração.
 */
export function contextUsage(i: ContextUsageInput): ContextUsage {
  const k = Number.isFinite(i.k) && i.k > 0 ? i.k : 1;
  const fixed = tokenCount(i.fixedEstimate);
  const { anchor } = i;

  if (isAnchorValid(anchor, i.current)) {
    const actual = Math.round(anchor.actualInputTokens);
    // Proporção de inteiros: Math.round já é exato aqui (só os produtos com k precisam de tolerância).
    const fixedReal = Math.round((actual * anchor.fixedEstimate) / (anchor.fixedEstimate + anchor.historyEstimate));
    const after = sumTokens(i.itemsAfterAnchor);
    const total = actual + roundProduct(k * (after + (fixed - anchor.fixedEstimate)));
    const used = actual - fixedReal + roundProduct(k * after);
    return { usedTokens: Math.max(0, used), totalInputTokens: Math.max(0, total), source: 'anchored' };
  }

  const total = roundProduct(k * (sumTokens(i.allItems) + fixed));
  const used = total - roundProduct(k * fixed);
  return { usedTokens: Math.max(0, used), totalInputTokens: Math.max(0, total), source: 'estimated' };
}
