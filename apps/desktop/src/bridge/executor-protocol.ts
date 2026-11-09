import { FAILURE_CODE, TOOL_NAMES } from '@jesus/executor/catalog';
import { z } from 'zod';
import { FailedMessageSchema, PingMessageSchema, PongMessageSchema, pingSeq, ReadyMessageSchema } from './protocol';

/**
 * Protocolo da ponte entre o processo principal e o Executor (`jesus-executor`, um utilityProcess; decisão 0026). O
 * principal manda cada chamada de ferramenta já conferida (`tool-run`), com a política do momento: as pastas
 * liberadas e os lugares do sistema. O Executor não guarda estado nem fala com a rede; responde com o texto para o
 * modelo e um resumo sem conteúdo para o registro (`tool-done`), ou a falha em texto e um código curto
 * (`tool-failed`). Toda mensagem é conferida dos dois lados com Zod estrito.
 */

/** Pastas liberadas ao mesmo tempo (o principal recusa liberar mais). */
export const MAX_RELEASED_FOLDERS = 32;
/** Texto de uma resposta (o Executor corta o conteúdo em 40 mil caracteres, mais as notas). */
export const MAX_TOOL_TEXT = 64_000;
/** Entrada de uma chamada, em caracteres do JSON (o esquema da ferramenta é bem menor). */
export const MAX_TOOL_INPUT_CHARS = 16_384;

const pathText = z.string().min(1).max(4_096);

export const PlacesSchema = z.strictObject({
  home: pathText,
  localAppData: pathText,
  roamingAppData: pathText,
  systemRoot: pathText.optional(),
  jesus: z.array(pathText).max(16).optional(),
  personal: z.array(pathText).max(16).optional(),
  system: z.array(pathText).max(64).optional(),
});
export type PlacesInput = z.infer<typeof PlacesSchema>;

export const ToolPolicySchema = z.strictObject({
  released: z.array(pathText).max(MAX_RELEASED_FOLDERS),
  places: PlacesSchema,
});
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

/** O JSON da entrada cabe no limite (o que não vira JSON, como um `bigint`, não passa). */
function fitsInput(input: unknown): boolean {
  try {
    return JSON.stringify(input).length <= MAX_TOOL_INPUT_CHARS;
  } catch {
    return false;
  }
}

/** A entrada de uma chamada, como objeto JSON pequeno (o esquema da ferramenta confere o resto). */
export const ToolInputSchema = z.record(z.string().max(64), z.unknown()).refine(fitsInput, 'entrada grande demais');

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ToolStatsSchema = z.discriminatedUnion('tool', [
  z.strictObject({ tool: z.literal('file_read'), firstLine: count, lastLine: count, totalLines: count, partial: z.boolean() }),
  z.strictObject({ tool: z.literal('file_list'), shown: count, total: count, more: z.boolean() }),
  z.strictObject({
    tool: z.literal('file_search'),
    results: count,
    files: count,
    stopped: z.enum(['results', 'files', 'bytes', 'entries', 'time']).nullable(),
  }),
]);
export type ToolStats = z.infer<typeof ToolStatsSchema>;

/** Segredos mascarados, por tipo (sem os valores). */
const SecretCountsSchema = z.record(z.string().regex(/^[a-z_]{1,32}$/), count).refine((counts) => Object.keys(counts).length <= 32, 'tipos demais');

// Processo principal → Executor.

export const ToolRunMessageSchema = z.strictObject({
  type: z.literal('tool-run'),
  id: pingSeq,
  name: z.enum(TOOL_NAMES),
  input: ToolInputSchema,
  policy: ToolPolicySchema,
});
export type ToolRunMessage = z.infer<typeof ToolRunMessageSchema>;

/** Para a chamada (o turno parou, o app bloqueou ou o tempo acabou). */
export const ToolCancelMessageSchema = z.strictObject({ type: z.literal('tool-cancel'), id: pingSeq });

export const ToExecutorMessageSchema = z.discriminatedUnion('type', [PingMessageSchema, ToolRunMessageSchema, ToolCancelMessageSchema]);
export type ToExecutorMessage = z.infer<typeof ToExecutorMessageSchema>;

// Executor → processo principal.

export const ToolDoneMessageSchema = z.strictObject({
  type: z.literal('tool-done'),
  id: pingSeq,
  text: z.string().min(1).max(MAX_TOOL_TEXT),
  secrets: SecretCountsSchema,
  stats: ToolStatsSchema,
});
export type ToolDoneMessage = z.infer<typeof ToolDoneMessageSchema>;

export const ToolFailedMessageSchema = z.strictObject({
  type: z.literal('tool-failed'),
  id: pingSeq,
  text: z.string().min(1).max(2_000),
  code: z.string().max(64).regex(FAILURE_CODE),
});
export type ToolFailedMessage = z.infer<typeof ToolFailedMessageSchema>;

export const FromExecutorMessageSchema = z.discriminatedUnion('type', [
  ReadyMessageSchema,
  FailedMessageSchema,
  PongMessageSchema,
  ToolDoneMessageSchema,
  ToolFailedMessageSchema,
]);
export type FromExecutorMessage = z.infer<typeof FromExecutorMessageSchema>;

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

export const parseToExecutor = (data: unknown): ToExecutorMessage | null => parseWith(ToExecutorMessageSchema, data);
export const parseFromExecutor = (data: unknown): FromExecutorMessage | null => parseWith(FromExecutorMessageSchema, data);
