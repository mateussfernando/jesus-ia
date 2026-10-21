import { EGRESS_FAILURES } from '@jesus/core/chat';
import { z } from 'zod';
import { FromBrainChatSchemas, ToBrainChatSchemas } from './chat-protocol';
import { bytes, FailedMessageSchema, headerName, headerValue, PingMessageSchema, PongMessageSchema, pingSeq } from './protocol';
import { FromBrainToolSchemas, ToBrainToolSchemas } from './tool-protocol';

/**
 * Protocolo da ponte entre o processo principal e o Cérebro (`jesus-brain`, um utilityProcess; decisão 0023). Tudo
 * passa pelo `parentPort`: o utilityProcess não transfere ports para o principal, então cada pedido à API leva um `id`,
 * e as respostas voltam com ele.
 *
 * O Cérebro não vê a chave da API nem a rede. O pedido que o AI SDK monta vai inteiro ao principal (`api-request`),
 * que confere, põe a chave e devolve a resposta em pedaços (`api-head`, `api-chunk`, `api-end`) ou o motivo da recusa
 * (`api-error`). Toda mensagem é conferida dos dois lados com Zod estrito: mensagem fora do protocolo derruba o
 * processo do Cérebro, que sobe de novo.
 */

/** O único destino da saída para a API (o principal confere o endereço inteiro). */
export const API_HOST = 'api.anthropic.com';
export const API_BASE_URL = `https://${API_HOST}/v1`;
/** O modelo do Cérebro na fase 1 (decisão 0011). */
export const BRAIN_MODEL_ID = 'claude-haiku-5-5';
/** O provedor do AI SDK exige uma chave: o Cérebro põe esta, e o principal a troca pela do cofre. */
export const BRAIN_KEY_PLACEHOLDER = 'jesus-brain-sem-chave';

/** Saída máxima (`max_tokens`) de um pedido à API; o raciocínio conta como saída. */
export const BRAIN_MAX_OUTPUT_TOKENS = 32_000;

/** Corpo máximo de um pedido à API, em bytes UTF-8 (o principal confere de novo antes de mandar). */
export const MAX_API_BODY_BYTES = 2 * 1024 * 1024;
/** Maior pedaço de resposta por mensagem; o principal fatia pedaços maiores. */
export const MAX_API_CHUNK_BYTES = 64 * 1024;
const MAX_API_HEADERS = 32;
const MAX_URL_LENGTH = 2048;

/**
 * Por que o principal não atendeu (ou interrompeu) um pedido. O Cérebro só recebe o motivo; o detalhe fica no
 * registro de auditoria do principal. A lista mora em `@jesus/core/chat`, junto com as falhas da conversa (cada falha
 * da saída é também uma da conversa), porque a interface mostra uma mensagem para cada uma.
 */
export { EGRESS_FAILURES };
export type { EgressFailure } from '@jesus/core/chat';

const ApiHeaderListSchema = z.array(z.tuple([headerName, headerValue])).max(MAX_API_HEADERS);

// Cérebro → processo principal (pelo parentPort).

export const BrainReadyMessageSchema = z.strictObject({
  type: z.literal('ready'),
  prepareMs: z.number().int().nonnegative().max(10 * 60 * 1000),
});

export const ApiRequestMessageSchema = z.strictObject({
  type: z.literal('api-request'),
  id: pingSeq,
  url: z.string().max(MAX_URL_LENGTH),
  method: z.string().min(1).max(16),
  headers: ApiHeaderListSchema,
  // O limite em bytes é conferido pelo principal; aqui, o tamanho do texto (nunca menor que o número de bytes / 3).
  body: z.string().max(MAX_API_BODY_BYTES),
});
export type ApiRequestMessage = z.infer<typeof ApiRequestMessageSchema>;

/** O AI SDK desistiu do pedido (o sinal de cancelamento disparou). */
export const ApiCancelMessageSchema = z.strictObject({ type: z.literal('api-cancel'), id: pingSeq });

export const FromBrainMessageSchema = z.discriminatedUnion('type', [
  BrainReadyMessageSchema,
  FailedMessageSchema,
  PongMessageSchema,
  ApiRequestMessageSchema,
  ApiCancelMessageSchema,
  ...FromBrainChatSchemas,
  ...FromBrainToolSchemas,
]);
export type FromBrainMessage = z.infer<typeof FromBrainMessageSchema>;

// Processo principal → Cérebro (pelo parentPort).

export const ApiHeadMessageSchema = z.strictObject({
  type: z.literal('api-head'),
  id: pingSeq,
  // O `Response` do Fetch só aceita 200 a 599, e um redirecionamento nunca chega aqui: o principal recusa.
  status: z
    .number()
    .int()
    .min(200)
    .max(599)
    .refine((status) => status < 300 || status >= 400, 'redirecionamento'),
  headers: ApiHeaderListSchema,
});
export const ApiChunkMessageSchema = z.strictObject({
  type: z.literal('api-chunk'),
  id: pingSeq,
  chunk: bytes(MAX_API_CHUNK_BYTES).refine((chunk) => chunk.byteLength > 0, 'pedaço vazio'),
});
export const ApiEndMessageSchema = z.strictObject({ type: z.literal('api-end'), id: pingSeq });
export const ApiErrorMessageSchema = z.strictObject({ type: z.literal('api-error'), id: pingSeq, reason: z.enum(EGRESS_FAILURES) });

export const ToBrainMessageSchema = z.discriminatedUnion('type', [
  PingMessageSchema,
  ApiHeadMessageSchema,
  ApiChunkMessageSchema,
  ApiEndMessageSchema,
  ApiErrorMessageSchema,
  ...ToBrainChatSchemas,
  ...ToBrainToolSchemas,
]);
export type ToBrainMessage = z.infer<typeof ToBrainMessageSchema>;
export type ToBrainApiMessage = Extract<ToBrainMessage, { type: 'api-head' | 'api-chunk' | 'api-end' | 'api-error' }>;

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

export const parseFromBrain = (data: unknown): FromBrainMessage | null => parseWith(FromBrainMessageSchema, data);
export const parseToBrain = (data: unknown): ToBrainMessage | null => parseWith(ToBrainMessageSchema, data);
