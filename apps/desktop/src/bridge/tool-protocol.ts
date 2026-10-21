import { TOOL_NAMES } from '@jesus/executor/catalog';
import { z } from 'zod';
import { chatId } from './chat-protocol';
import { MAX_TOOL_TEXT, ToolInputSchema } from './executor-protocol';
import { pingSeq } from './protocol';

/**
 * Mensagens das ferramentas entre o Cérebro e o processo principal (decisão 0026). O Cérebro só propõe: cada chamada que
 * o modelo faz vira um `tool-call`, com o `id` do turno da conversa em que ela acontece. O principal confere (esquema,
 * turno em andamento, Porteiro, registro), repassa ao Executor e devolve só o texto para o modelo (`tool-result`).
 * `tool-cancel`: o turno parou, e a chamada não interessa mais.
 */

export const BrainToolCallSchema = z.strictObject({
  type: z.literal('tool-call'),
  id: pingSeq,
  /** O `id` do `chat-send` do turno (o do lado do Cérebro). */
  turn: chatId,
  name: z.enum(TOOL_NAMES),
  input: ToolInputSchema,
});
export type BrainToolCall = z.infer<typeof BrainToolCallSchema>;

export const BrainToolCancelSchema = z.strictObject({ type: z.literal('tool-cancel'), id: pingSeq });

export const BrainToolResultSchema = z.strictObject({
  type: z.literal('tool-result'),
  id: pingSeq,
  ok: z.boolean(),
  text: z.string().min(1).max(MAX_TOOL_TEXT),
});
export type BrainToolResult = z.infer<typeof BrainToolResultSchema>;

export const FromBrainToolSchemas = [BrainToolCallSchema, BrainToolCancelSchema] as const;
export const ToBrainToolSchemas = [BrainToolResultSchema] as const;
