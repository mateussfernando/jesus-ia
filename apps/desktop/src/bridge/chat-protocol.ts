import { z } from 'zod';

/**
 * Mensagens da conversa (fase 1, etapas 10 e 11; decisão 0024). A conversa mora no Cérebro (`jesus-brain`); a tela, no
 * servidor da interface (`jesus-next`). O processo principal fica no meio e só repassa, conferindo as duas pontes com
 * Zod estrito e trocando os `id` de um lado pelos do outro:
 * - interface → principal: `chat` (`get`, `send`, `stop`, `reset`); principal → interface: `chat-event`;
 * - principal → Cérebro: `chat-get`, `chat-send`, `chat-stop`, `chat-reset`; Cérebro → principal: `chat-state`,
 *   `chat-delta`, `chat-done`, `chat-error`.
 * Este arquivo não importa as outras pontes (elas é que importam daqui), para não haver ciclo.
 */

/** Maior pergunta (caracteres). Uma conversa inteira cabe em uns 88 mil tokens. */
export const MAX_CHAT_TEXT_CHARS = 20_000;
/** Maior pedaço de resposta por mensagem; o Cérebro junta os pedaços do modelo e fatia os grandes. */
export const MAX_CHAT_DELTA_CHARS = 8_192;
/** Maior resposta guardada (a saída máxima, 32 mil tokens, dá uns 128 mil caracteres). */
export const MAX_ANSWER_CHARS = 200_000;
export const MAX_CHAT_TURNS = 200;
/** Texto da conversa inteira numa mensagem (o limite de contexto a deixa bem menor). */
export const MAX_TRANSCRIPT_CHARS = 2_000_000;
/** Texto que o principal aceita do Cérebro num só turno; além disso, o Cérebro fugiu do protocolo. */
export const MAX_TURN_STREAM_CHARS = 1_000_000;

/**
 * Por que um turno da conversa não terminou bem:
 * - as falhas da saída para a API (`refused` a `internal`, decisão 0023);
 * - `api_auth`: a Anthropic recusou a chave; `api_rate`: limite de uso da conta; `api_overloaded`: a API está
 *   sobrecarregada ou com erro; `api_invalid`: a API recusou o pedido;
 * - `refusal`: o modelo recusou responder; `empty_answer`: veio resposta sem texto;
 * - `cancelled`: o dono parou; `stale`: a conversa da tela não é mais a do Cérebro (ele reiniciou, ou outra começou);
 * - `turn_running`: já há um turno em andamento; `context_full`: a conversa ficou longa e precisa de uma nova;
 * - `empty`: pergunta vazia; `brain`: o Cérebro caiu ou falhou; `unavailable`: sem Cérebro (fora do app de desktop).
 */
export const CHAT_FAILURES = [
  'refused',
  'no_key',
  'vault',
  'over_budget',
  'busy',
  'audit',
  'locked',
  'network',
  'timeout',
  'redirect',
  'too_large',
  'interrupted',
  'internal',
  'api_auth',
  'api_rate',
  'api_overloaded',
  'api_invalid',
  'refusal',
  'empty_answer',
  'cancelled',
  'stale',
  'turn_running',
  'context_full',
  'empty',
  'brain',
  'unavailable',
] as const;
export type ChatFailure = (typeof CHAT_FAILURES)[number];

export const chatId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const conversationId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const tokens = z.number().int().nonnegative().max(10_000_000);
const question = z.string().min(1).max(MAX_CHAT_TEXT_CHARS);

export const ChatTurnSchema = z.strictObject({ user: z.string().max(MAX_CHAT_TEXT_CHARS), assistant: z.string().max(MAX_ANSWER_CHARS) });
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** A conversa como o Cérebro a guarda: só as trocas que terminaram. */
export const ChatStateSchema = z.strictObject({
  conversationId,
  turns: z
    .array(ChatTurnSchema)
    .max(MAX_CHAT_TURNS)
    .refine((turns) => turns.reduce((sum, turn) => sum + turn.user.length + turn.assistant.length, 0) <= MAX_TRANSCRIPT_CHARS, 'conversa grande demais'),
  /** Tokens que a conversa ocupa (medidos na última resposta) e o limite dela. */
  contextTokens: tokens,
  limitTokens: tokens,
  /** Há um turno em andamento. */
  busy: z.boolean(),
});
export type ChatState = z.infer<typeof ChatStateSchema>;

/** O turno terminou e entrou na conversa. `length`: a resposta foi cortada na saída máxima. */
export const ChatDoneSchema = z.strictObject({
  conversationId,
  finish: z.enum(['stop', 'length']),
  contextTokens: tokens,
  limitTokens: tokens,
});
export type ChatDone = z.infer<typeof ChatDoneSchema>;

// Processo principal → Cérebro.

export const BrainChatGetSchema = z.strictObject({ type: z.literal('chat-get'), id: chatId });
export const BrainChatResetSchema = z.strictObject({ type: z.literal('chat-reset'), id: chatId });
export const BrainChatSendSchema = z.strictObject({ type: z.literal('chat-send'), id: chatId, conversationId, text: question });
/** Para o turno daquele `id` (se ainda estiver em andamento). */
export const BrainChatStopSchema = z.strictObject({ type: z.literal('chat-stop'), id: chatId });
export const ToBrainChatSchemas = [BrainChatGetSchema, BrainChatResetSchema, BrainChatSendSchema, BrainChatStopSchema] as const;
export type ToBrainChatMessage = z.infer<(typeof ToBrainChatSchemas)[number]>;

// Cérebro → processo principal.

export const BrainChatStateSchema = z.strictObject({ type: z.literal('chat-state'), id: chatId, state: ChatStateSchema });
export const BrainChatDeltaSchema = z.strictObject({ type: z.literal('chat-delta'), id: chatId, text: z.string().min(1).max(MAX_CHAT_DELTA_CHARS) });
export const BrainChatDoneSchema = z.strictObject({ type: z.literal('chat-done'), id: chatId, done: ChatDoneSchema });
export const BrainChatErrorSchema = z.strictObject({ type: z.literal('chat-error'), id: chatId, reason: z.enum(CHAT_FAILURES) });
export const FromBrainChatSchemas = [BrainChatStateSchema, BrainChatDeltaSchema, BrainChatDoneSchema, BrainChatErrorSchema] as const;
export type FromBrainChatMessage = z.infer<(typeof FromBrainChatSchemas)[number]>;

// Servidor da interface → processo principal.

export const CHAT_OPS = ['get', 'send', 'stop', 'reset'] as const;
export const UiChatRequestSchema = z
  .strictObject({
    type: z.literal('chat'),
    /** Em `stop`, o `id` do `send` que deve parar. */
    id: chatId,
    op: z.enum(CHAT_OPS),
    conversationId: conversationId.optional(),
    text: question.optional(),
  })
  .refine(
    (request) => (request.op === 'send') === (request.conversationId !== undefined && request.text !== undefined),
    'só o send leva conversa e texto, e sempre os dois',
  )
  .refine((request) => request.op === 'send' || (request.conversationId === undefined && request.text === undefined), 'campo a mais');
export type UiChatRequest = z.infer<typeof UiChatRequestSchema>;

// Processo principal → servidor da interface.

export const ChatEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('state'), state: ChatStateSchema }),
  z.strictObject({ kind: z.literal('delta'), text: z.string().min(1).max(MAX_CHAT_DELTA_CHARS) }),
  z.strictObject({ kind: z.literal('done'), done: ChatDoneSchema }),
  z.strictObject({ kind: z.literal('error'), reason: z.enum(CHAT_FAILURES) }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const UiChatEventSchema = z.strictObject({ type: z.literal('chat-event'), id: chatId, event: ChatEventSchema });
export type UiChatEvent = z.infer<typeof UiChatEventSchema>;
