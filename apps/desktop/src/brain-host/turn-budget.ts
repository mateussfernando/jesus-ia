/**
 * O orçamento de um turno com ferramentas (etapa 13; decisão 0026), no Cérebro. Um turno tem até `MAX_TURN_STEPS`
 * passos (chamadas ao modelo). A cada passo, a entrada cresce com o que o modelo escreveu no passo anterior (raciocínio
 * e chamadas) e com as respostas das ferramentas. O teto é o limite da conversa (`limitTokens`, que fica abaixo da faixa
 * de preço de 100 mil tokens do Haiku 5.5).
 *
 * - **Antes de cada passo**, a entrada é refeita pelo uso medido do passo anterior (entrada mais saída), somado às
 *   respostas das ferramentas, estimadas. Uso que não veio conta como sem espaço (falha fechada: mais nenhuma leitura).
 * - **Cada chamada reserva** o pior caso razoável de uma resposta (`TOOL_RESERVE_TOKENS`). Sem espaço para a reserva, ou
 *   passado o número de chamadas do turno, a chamada é recusada com um texto para o modelo, que responde com o que já
 *   tem. Ao terminar, a reserva dá lugar ao tamanho estimado da resposta.
 * - **Sem ferramentas** no último passo e quando não cabe mais nenhuma leitura: o modelo responde em texto.
 *
 * Só números: sem relógio, rede nem disco.
 */

/** Passos (chamadas ao modelo) de um turno. */
export const MAX_TURN_STEPS = 8;
/**
 * Chamadas de ferramenta de um turno. Fica abaixo do que o principal aceita do Cérebro numa janela de 5 s (32, em
 * `brain-process.ts`): o modelo pedindo leituras demais recebe um texto, em vez de derrubar o Cérebro.
 */
export const MAX_TURN_TOOL_CALLS = 24;
/**
 * Reserva de uma chamada: a resposta de uma ferramenta tem até 40 mil caracteres de conteúdo (`responseChars` do
 * Executor), uns 16 mil tokens em código, e a reserva conta 2 caracteres por token.
 */
export const TOOL_RESERVE_TOKENS = 20_000;
/** Folga para a saída do passo em andamento (raciocínio e chamadas), que só se sabe no fim dele. */
export const STEP_OUTPUT_MARGIN = 4_000;
/** Custo fixo de cada resposta de ferramenta no pedido (o bloco e os separadores), em tokens. */
export const TOOL_RESULT_OVERHEAD = 16;

export type ReserveRefusal = 'calls' | 'context';

export interface StepUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

function isCount(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

export class TurnBudget {
  readonly #limit: number;
  #estimate: number;
  #reserved = 0;
  #results = 0;
  #calls = 0;

  /**
   * @param limit O limite da conversa, em tokens.
   * @param firstStep A entrada estimada do primeiro passo (a conversa até aqui, a nota das pastas e a pergunta).
   */
  constructor(limit: number, firstStep: number) {
    this.#limit = limit;
    this.#estimate = isCount(firstStep) ? firstStep : Number.POSITIVE_INFINITY;
  }

  /** Entrada estimada do passo em andamento (infinita depois de um passo sem o uso medido). */
  get estimate(): number {
    return this.#estimate;
  }

  /** Chamadas aceitas no turno. */
  get calls(): number {
    return this.#calls;
  }

  #room(): number {
    return this.#limit - this.#estimate - STEP_OUTPUT_MARGIN - this.#reserved - this.#results;
  }

  /** Reserva espaço para uma chamada. `null`: reservado; senão, o motivo da recusa. */
  reserve(): ReserveRefusal | null {
    if (this.#calls >= MAX_TURN_TOOL_CALLS) return 'calls';
    if (!(this.#room() >= TOOL_RESERVE_TOKENS)) return 'context';
    this.#calls += 1;
    this.#reserved += TOOL_RESERVE_TOKENS;
    return null;
  }

  /** Uma chamada reservada terminou: no lugar da reserva, a resposta (em tokens estimados). */
  settle(resultTokens: number): void {
    this.#reserved = Math.max(0, this.#reserved - TOOL_RESERVE_TOKENS);
    this.addResult(resultTokens);
  }

  /** Uma resposta que vai ao modelo sem reserva (a recusa de uma chamada). */
  addResult(resultTokens: number): void {
    this.#results += TOOL_RESULT_OVERHEAD + (isCount(resultTokens) ? resultTokens : TOOL_RESERVE_TOKENS);
  }

  /** Começa o passo seguinte, com o uso medido do passo que terminou. */
  nextStep(usage: StepUsage | undefined): void {
    const input = usage?.inputTokens;
    const output = usage?.outputTokens;
    this.#estimate = isCount(input) && isCount(output) && input > 0 ? input + output + this.#results : Number.POSITIVE_INFINITY;
    this.#results = 0;
    this.#reserved = 0;
  }

  /** O passo `stepNumber` (contando de 0) pode oferecer ferramentas ao modelo. */
  toolsAllowed(stepNumber: number): boolean {
    return stepNumber < MAX_TURN_STEPS - 1 && this.#calls < MAX_TURN_TOOL_CALLS && this.#room() >= TOOL_RESERVE_TOKENS;
  }
}
