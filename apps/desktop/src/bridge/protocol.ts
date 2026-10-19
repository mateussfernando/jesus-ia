import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { isAppUrl } from '../main/policy/url';

/**
 * Protocolo da ponte entre o processo principal e o servidor da interface (`jesus-next`, um utilityProcess; decisão
 * 0017). Cada pedido da janela vira uma mensagem `request` com um `MessagePort` só dele; a resposta volta por esse
 * port em pedaços, com crédito (contrapressão).
 *
 * Toda mensagem é conferida dos dois lados com Zod estrito: campo a mais, tipo errado ou tamanho fora do limite
 * derruba o pedido (falha fechada), nunca é "consertado". A configuração (pastas) chega por mensagem, uma vez só:
 * nada de configuração pelo ambiente do processo.
 */

/** Corpo máximo de um pedido da janela (Server Action). O principal responde 413 acima disso. */
export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
/** Maior pedaço de corpo de resposta por mensagem; pedaços maiores são fatiados pelo servidor. */
export const MAX_CHUNK_BYTES = 64 * 1024;
/** Pedaços em trânsito antes de o servidor esperar a confirmação (`ack`) do principal. */
export const CREDIT_WINDOW = 8;
export const MAX_HEADERS = 128;
/** Soma dos tamanhos de nomes e valores dos cabeçalhos de um pedido ou resposta. */
export const MAX_HEADER_BYTES = 64 * 1024;
export const MAX_URL_LENGTH = 8 * 1024;
const MAX_PATH_LENGTH = 1024;
const MAX_FAILURE_MESSAGE = 4000;

/** Métodos que a interface usa: páginas (GET/HEAD) e Server Actions (POST). O resto o principal recusa com 405. */
export const BRIDGE_METHODS = ['GET', 'HEAD', 'POST'] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Valor de cabeçalho válido no Fetch: sem CR, LF nem NUL. */
function isHeaderValue(value: string): boolean {
  return !/[\r\n]/.test(value) && !value.includes('\u0000');
}

const headerName = z.string().min(1).max(256).regex(HEADER_NAME);
const headerValue = z.string().max(16 * 1024).refine(isHeaderValue, 'valor de cabeçalho inválido');

export const HeaderListSchema = z
  .array(z.tuple([headerName, headerValue]))
  .max(MAX_HEADERS)
  .refine(
    (headers) => headers.reduce((total, [name, value]) => total + name.length + value.length, 0) <= MAX_HEADER_BYTES,
    'cabeçalhos grandes demais',
  );
export type HeaderList = z.infer<typeof HeaderListSchema>;

const absolutePath = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((path) => !path.includes('\u0000') && isAbsolute(path), 'caminho absoluto esperado');

const bytes = (max: number) => z.instanceof(Uint8Array).refine((chunk) => chunk.byteLength <= max, 'grande demais');

export const RequestMetaSchema = z
  .strictObject({
    url: z.string().max(MAX_URL_LENGTH).refine(isAppUrl, 'endereço fora do app'),
    method: z.enum(BRIDGE_METHODS),
    headers: HeaderListSchema,
    body: bytes(MAX_REQUEST_BODY_BYTES).nullable(),
  })
  .refine((meta) => meta.body === null || meta.method === 'POST', 'corpo só em POST');
export type RequestMeta = z.infer<typeof RequestMetaSchema>;

// Processo principal → servidor da interface (pelo parentPort).

export const ConfigMessageSchema = z.strictObject({
  type: z.literal('config'),
  /** Pasta do app Next já compilado (a que tem `.next/`). */
  uiDir: absolutePath,
  /** Pasta de dados do Jesus (credencial da senha local, enquanto o PostgreSQL embutido não chega). */
  dataDir: absolutePath,
  /** Tempo sem uso até bloquear, em ms. Só o build de teste manda (para os testes não esperarem 15 min). */
  idleMs: z.number().int().min(1_000).max(120 * 60_000).optional(),
});
export type ConfigMessage = z.infer<typeof ConfigMessageSchema>;

export const RequestMessageSchema = z.strictObject({ type: z.literal('request'), meta: RequestMetaSchema });
export type RequestMessage = z.infer<typeof RequestMessageSchema>;

const pingSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Sinal de vida: o principal pergunta de tempos em tempos, e o servidor responde `pong` na hora. */
export const PingMessageSchema = z.strictObject({ type: z.literal('ping'), seq: pingSeq });

/** Bloqueios que vêm do Windows (sessão bloqueada, suspensão), vistos pelo principal (decisão 0019). */
export const HOST_LOCK_REASONS = ['os_locked', 'suspend'] as const;
export type HostLockReason = (typeof HOST_LOCK_REASONS)[number];

/** Bloqueia agora. O servidor responde `lock-ack` com o mesmo número depois de aplicar; sem resposta, reinicia. */
export const LockMessageSchema = z.strictObject({ type: z.literal('lock'), reason: z.enum(HOST_LOCK_REASONS), seq: pingSeq });
/** Uso de verdade (tecla, clique, rolagem) na janela, visto pelo principal: a página não consegue fingir. */
export const ActivityMessageSchema = z.strictObject({ type: z.literal('activity') });

export type LockMessage = z.infer<typeof LockMessageSchema>;
export type ActivityMessage = z.infer<typeof ActivityMessageSchema>;

export const ToServerMessageSchema = z.discriminatedUnion('type', [
  ConfigMessageSchema,
  RequestMessageSchema,
  PingMessageSchema,
  LockMessageSchema,
  ActivityMessageSchema,
]);
export type ToServerMessage = z.infer<typeof ToServerMessageSchema>;

// Servidor da interface → processo principal (pelo parentPort).

export const ReadyMessageSchema = z.strictObject({
  type: z.literal('ready'),
  prepareMs: z.number().int().nonnegative().max(10 * 60 * 1000),
});
export const FailedMessageSchema = z.strictObject({
  type: z.literal('failed'),
  message: z.string().max(MAX_FAILURE_MESSAGE),
});
export const PongMessageSchema = z.strictObject({ type: z.literal('pong'), seq: pingSeq });
export const LockAckMessageSchema = z.strictObject({ type: z.literal('lock-ack'), seq: pingSeq });
export const FromServerMessageSchema = z.discriminatedUnion('type', [
  ReadyMessageSchema,
  FailedMessageSchema,
  PongMessageSchema,
  LockAckMessageSchema,
]);
export type FromServerMessage = z.infer<typeof FromServerMessageSchema>;

// Port de cada pedido: principal → servidor.

/** `ack`: o principal consumiu um pedaço (devolve um crédito). `cancel`: a janela desistiu do pedido. */
export const RequestPortInSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ack') }),
  z.strictObject({ type: z.literal('cancel') }),
]);
export type RequestPortIn = z.infer<typeof RequestPortInSchema>;

// Port de cada pedido: servidor → principal.

export const HeadMessageSchema = z.strictObject({
  type: z.literal('head'),
  // O `Response` do Fetch só aceita 200 a 599.
  status: z.number().int().min(200).max(599),
  statusText: z.string().max(128).refine(isHeaderValue, 'texto de status inválido'),
  headers: HeaderListSchema,
});
export const ChunkMessageSchema = z.strictObject({
  type: z.literal('chunk'),
  chunk: bytes(MAX_CHUNK_BYTES).refine((chunk) => chunk.byteLength > 0, 'pedaço vazio'),
});

/** `error` não leva detalhe: o motivo fica no registro do servidor, nunca vai para a janela. */
export const RequestPortOutSchema = z.discriminatedUnion('type', [
  HeadMessageSchema,
  ChunkMessageSchema,
  z.strictObject({ type: z.literal('end') }),
  z.strictObject({ type: z.literal('error') }),
]);
export type RequestPortOut = z.infer<typeof RequestPortOutSchema>;

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

export const parseToServer = (data: unknown): ToServerMessage | null => parseWith(ToServerMessageSchema, data);
export const parseFromServer = (data: unknown): FromServerMessage | null => parseWith(FromServerMessageSchema, data);
export const parseRequestPortIn = (data: unknown): RequestPortIn | null => parseWith(RequestPortInSchema, data);
export const parseRequestPortOut = (data: unknown): RequestPortOut | null => parseWith(RequestPortOutSchema, data);
