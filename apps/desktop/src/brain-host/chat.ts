import { computeContextBudget } from '@jesus/core';
import { estimateTextTokens } from '@jesus/models';
import type { ModelCard } from '@jesus/models';
import { maskSecrets } from '@jesus/shared';
import { APICallError, streamText } from 'ai';
import type { FinishReason, LanguageModel, LanguageModelUsage, ModelMessage } from 'ai';
import { BRAIN_MAX_OUTPUT_TOKENS } from '../bridge/brain-protocol';
import { MAX_ANSWER_CHARS, MAX_CHAT_DELTA_CHARS, MAX_CHAT_TURNS } from '../bridge/chat-protocol';
import type { ChatDone, ChatFailure, ChatState, ChatTurn } from '../bridge/chat-protocol';
import { egressFailureOf } from './api-fetch';
import { refuseDownload } from './model';

/**
 * O laço da conversa (fase 1, etapa 10; decisão 0024), no Cérebro. Uma conversa por vez, só na memória deste processo:
 * fechar o app (ou o Cérebro cair) a apaga.
 *
 * - **Histórico só de acréscimo**, só com as trocas que terminaram. Guarda o texto das respostas, sem os blocos de
 *   raciocínio: numa conversa sem ferramentas a API não exige devolvê-los, e devolvê-los custaria entrada (o Haiku 5.5
 *   relê o raciocínio cifrado) e 32 mil tokens de reserva por bloco no teto do dia. Como nenhum bloco de raciocínio é
 *   devolvido, nenhum fica inválido por mudança no histórico.
 * - **Segredos mascarados uma vez**, ao entrar no histórico: a pergunta sai para o modelo já mascarada.
 * - **Pedido:** `effort: 'medium'`, raciocínio adaptativo, sem amostragem nem resposta pré-escrita, nenhuma nova
 *   tentativa automática (`maxRetries: 0`: quem decide é a saída do principal, que cobra), saída máxima de 32 mil
 *   tokens e pontos de cache no sistema e no fim do histórico.
 * - **Limite de contexto** pelo orçamento do modelo (`computeContextBudget`, ~88 mil tokens no Haiku 5.5, abaixo da
 *   faixa de preço de 100 mil): passou, a conversa pede uma nova.
 * - Turno que falha, é parado ou recusado não entra no histórico (a tela mostra o que veio e o motivo).
 */

export interface ChatSink {
  delta(text: string): void;
  done(done: ChatDone): void;
  fail(reason: ChatFailure): void;
}

export interface ChatEngineOptions {
  readonly model: LanguageModel;
  readonly card: ModelCard;
  readonly now?: () => Date;
  readonly newConversationId?: () => string;
  /** De quanto em quanto tempo os pedaços da resposta seguem juntos (ms). */
  readonly flushMs?: number;
}

/** Custo fixo de cada mensagem no histórico (separadores de papel), em tokens. */
const TOKENS_PER_MESSAGE = 8;
const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;

/** As instruções do Jesus nesta fase (a data entra uma vez por conversa, para não mudar o prefixo em cache). */
export function systemPrompt(today: Date): string {
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(today);
  return [
    'Você é o Jesus, o assistente pessoal de IA do dono deste computador (Windows).',
    'Responda em português do Brasil, de forma clara e direta, no tamanho que a pergunta pede.',
    'Nesta versão você só conversa: não lê arquivos, não acessa a internet, não executa comandos e não age por conta própria. Se o pedido precisar disso, diga que ainda não consegue fazer.',
    'Nunca diga que fez algo que não fez. Se não souber, diga que não sabe.',
    'Não peça senhas, chaves nem códigos. Segredos que o dono colar chegam mascarados.',
    `Hoje é ${date}.`,
  ].join('\n');
}

/** Status HTTP de um erro da API, procurando nas causas. */
function apiStatusOf(error: unknown): number | null {
  const seen = new Set<unknown>();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (APICallError.isInstance(current)) return current.statusCode ?? null;
  }
  return null;
}

/** O motivo de um turno que falhou: a recusa da saída do principal, o status da API ou falha do próprio Cérebro. */
export function chatFailureOf(error: unknown): ChatFailure {
  const egress = egressFailureOf(error);
  if (egress !== null) return egress;
  const status = apiStatusOf(error);
  if (status === null) return 'brain';
  if (status === 401 || status === 403) return 'api_auth';
  if (status === 429) return 'api_rate';
  if (status >= 500) return 'api_overloaded';
  return 'api_invalid';
}

/** Junta os pedaços da resposta e os manda de tempos em tempos, em partes de até `MAX_CHAT_DELTA_CHARS`. */
class DeltaBatcher {
  #buffer = '';
  #timer: NodeJS.Timeout | null = null;
  readonly #send: (text: string) => void;
  readonly #flushMs: number;

  constructor(send: (text: string) => void, flushMs: number) {
    this.#send = send;
    this.#flushMs = flushMs;
  }

  push(text: string): void {
    this.#buffer += text;
    if (this.#buffer.length >= MAX_CHAT_DELTA_CHARS) {
      this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => this.flush(), this.#flushMs);
  }

  flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    while (this.#buffer.length > 0) {
      let cut = Math.min(this.#buffer.length, MAX_CHAT_DELTA_CHARS);
      // Não parte um par de surrogates (um emoji) ao meio.
      const last = this.#buffer.charCodeAt(cut - 1);
      if (cut < this.#buffer.length && last >= 0xd800 && last <= 0xdbff) cut -= 1;
      this.#send(this.#buffer.slice(0, cut));
      this.#buffer = this.#buffer.slice(cut);
    }
  }

  /** Descarta o que não saiu (o turno acabou de outro jeito). */
  drop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#buffer = '';
  }
}

interface Running {
  readonly controller: AbortController;
  readonly conversationId: string;
}

export class ChatEngine {
  readonly #model: LanguageModel;
  readonly #card: ModelCard;
  readonly #now: () => Date;
  readonly #newConversationId: () => string;
  readonly #flushMs: number;
  #conversationId: string;
  #system: string;
  #turns: ChatTurn[] = [];
  #contextTokens: number;
  #limitTokens: number;
  #running: Running | null = null;

  constructor(options: ChatEngineOptions) {
    this.#model = options.model;
    this.#card = options.card;
    this.#now = options.now ?? (() => new Date());
    this.#newConversationId = options.newConversationId ?? (() => globalThis.crypto.randomUUID());
    this.#flushMs = options.flushMs ?? 30;
    this.#conversationId = this.#newConversationId();
    this.#system = systemPrompt(this.#now());
    this.#contextTokens = this.#estimate(this.#system);
    this.#limitTokens = this.#budgetLimit();
  }

  #estimate(text: string): number {
    return TOKENS_PER_MESSAGE + estimateTextTokens(text, this.#card.tokenizer);
  }

  /** Limite da conversa pelo orçamento do modelo, com o teto padrão do dia (decisão 0024). */
  #budgetLimit(): number {
    const budget = computeContextBudget({
      card: this.#card,
      fixedTokens: this.#estimate(this.#system),
      spend: { dailyLimitUsd: 1, spentTodayUsd: 0 },
    });
    return Math.max(1, Math.floor(budget.limit));
  }

  state(): ChatState {
    return {
      conversationId: this.#conversationId,
      turns: this.#turns.map((turn) => ({ ...turn })),
      contextTokens: Math.min(this.#contextTokens, 10_000_000),
      limitTokens: this.#limitTokens,
      busy: this.#running !== null,
    };
  }

  /** Começa uma conversa nova (o turno em andamento, se houver, é parado). */
  reset(): ChatState {
    this.#running?.controller.abort();
    this.#running = null;
    this.#conversationId = this.#newConversationId();
    this.#system = systemPrompt(this.#now());
    this.#turns = [];
    this.#contextTokens = this.#estimate(this.#system);
    this.#limitTokens = this.#budgetLimit();
    return this.state();
  }

  /** Começa um turno. A função devolvida para o turno (o dono clicou em Parar). Todo turno termina em `done` ou `fail`. */
  send(conversationId: string, text: string, sink: ChatSink): () => void {
    const noop = () => undefined;
    if (conversationId !== this.#conversationId) {
      sink.fail('stale');
      return noop;
    }
    if (this.#running !== null) {
      sink.fail('turn_running');
      return noop;
    }
    const question = maskSecrets(text.trim()).text;
    if (question === '') {
      sink.fail('empty');
      return noop;
    }
    if (this.#turns.length >= MAX_CHAT_TURNS || this.#contextTokens + this.#estimate(question) >= this.#limitTokens) {
      sink.fail('context_full');
      return noop;
    }
    const running: Running = { controller: new AbortController(), conversationId };
    this.#running = running;
    void this.#run(running, question, sink);
    return () => {
      if (this.#running === running) running.controller.abort();
    };
  }

  #messages(question: string): ModelMessage[] {
    const history = this.#turns.flatMap((turn): ModelMessage[] => [
      { role: 'user', content: turn.user },
      { role: 'assistant', content: turn.assistant },
    ]);
    return [
      { role: 'system', content: this.#system, providerOptions: ANTHROPIC_CACHE },
      ...history,
      { role: 'user', content: question, providerOptions: ANTHROPIC_CACHE },
    ];
  }

  async #run(running: Running, question: string, sink: ChatSink): Promise<void> {
    let answer = '';
    let finishReason: FinishReason | undefined;
    let rawFinishReason: string | undefined;
    let usage: LanguageModelUsage | undefined;
    let failure: unknown = null;
    let aborted = false;
    let tooLarge = false;
    const batcher = new DeltaBatcher((piece) => sink.delta(piece), this.#flushMs);
    try {
      const result = streamText({
        model: this.#model,
        messages: this.#messages(question),
        allowSystemInMessages: true,
        maxRetries: 0,
        maxOutputTokens: BRAIN_MAX_OUTPUT_TOKENS,
        experimental_download: refuseDownload,
        abortSignal: running.controller.signal,
        providerOptions: { anthropic: { effort: 'medium', thinking: { type: 'adaptive' } } },
      });
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          if (answer.length + part.text.length > MAX_ANSWER_CHARS) {
            // Sair do laço cancela o fluxo (e o pedido à API).
            tooLarge = true;
            break;
          }
          answer += part.text;
          batcher.push(part.text);
        } else if (part.type === 'finish') {
          finishReason = part.finishReason;
          rawFinishReason = part.rawFinishReason;
          usage = part.totalUsage;
        } else if (part.type === 'error') {
          failure = part.error;
        } else if (part.type === 'abort') {
          aborted = true;
        }
      }
    } catch (error) {
      // Falha no meio do corpo: o AI SDK lança, com o erro da saída como causa.
      if (running.controller.signal.aborted) aborted = true;
      else failure = error;
    }

    const end = (outcome: { readonly fail: ChatFailure } | { readonly done: ChatDone }) => {
      if (this.#running === running) this.#running = null;
      if ('fail' in outcome) {
        batcher.drop();
        sink.fail(outcome.fail);
        return;
      }
      batcher.flush();
      sink.done(outcome.done);
    };

    if (tooLarge) {
      end({ fail: 'too_large' });
      return;
    }
    if (aborted || running.controller.signal.aborted) {
      end({ fail: 'cancelled' });
      return;
    }
    if (failure !== null) {
      end({ fail: chatFailureOf(failure) });
      return;
    }
    if (finishReason === 'content-filter' || rawFinishReason === 'refusal') {
      end({ fail: 'refusal' });
      return;
    }
    if (finishReason !== 'stop' && finishReason !== 'length') {
      end({ fail: 'api_invalid' });
      return;
    }
    if (answer.trim() === '') {
      end({ fail: 'empty_answer' });
      return;
    }
    // A conversa mudou no meio (uma nova começou): este turno não entra em nenhuma.
    if (running.conversationId !== this.#conversationId) {
      end({ fail: 'stale' });
      return;
    }

    this.#turns.push({ user: question, assistant: answer });
    // O que a conversa ocupa agora: a entrada medida mais a saída (o raciocínio não volta, então isto sobra um pouco).
    const measured = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    const estimated = this.#contextTokens + this.#estimate(question) + this.#estimate(answer);
    this.#contextTokens = measured > 0 ? measured : estimated;
    end({
      done: {
        conversationId: this.#conversationId,
        finish: finishReason,
        contextTokens: Math.min(this.#contextTokens, 10_000_000),
        limitTokens: this.#limitTokens,
      },
    });
  }
}
