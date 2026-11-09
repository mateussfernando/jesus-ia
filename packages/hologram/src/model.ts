import { z } from 'zod';

/**
 * Estados do holograma (docs/08-holograma.md, seção 8.3).
 * Identificadores em inglês; os rótulos em pt-BR ficam em `describe.ts`.
 */
export const hologramStates = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'executing',
  'awaiting',
  'blocked',
  'compacting',
  'offline',
] as const;

export const hologramStateSchema = z.enum(hologramStates);
export type HologramState = z.infer<typeof hologramStateSchema>;

/** Nível de acesso de uma conta conectada: anel simples = leitura, anel duplo = leitura e escrita. */
export const satelliteAccessSchema = z.enum(['read', 'read_write']);
export type SatelliteAccess = z.infer<typeof satelliteAccessSchema>;

export const satelliteSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(40),
    access: satelliteAccessSchema,
  })
  .strict();
export type Satellite = z.infer<typeof satelliteSchema>;

/** Estado de contaminação da tarefa (docs/03-seguranca.md, seção 3.4.6). */
export const taintSchema = z.enum(['clean', 'tainted', 'suspicious']);
export type Taint = z.infer<typeof taintSchema>;

/**
 * Pulso de luz num fio entre a esfera e um satélite.
 * - `action`: indo (esfera → satélite);
 * - `data`: voltando (satélite → esfera);
 * - `blocked`: ação barrada no losango do Porteiro.
 */
export const pulseKindSchema = z.enum(['action', 'data', 'blocked']);
export type PulseKind = z.infer<typeof pulseKindSchema>;

export const pulseSchema = z
  .object({
    id: z.string().min(1).max(64),
    satelliteId: z.string().min(1).max(64),
    kind: pulseKindSchema,
    /** Instante de início, em milissegundos, no mesmo relógio passado para o holograma (`performance.now()`). */
    startedAt: z.number().finite(),
  })
  .strict();
export type Pulse = z.infer<typeof pulseSchema>;

export const MAX_SATELLITES = 8;
export const MAX_SUBAGENTS = 4;
export const MAX_MEMORY_STARS = 400;

/**
 * Tudo o que o holograma mostra. Quando o app existir, este objeto chega do processo principal por IPC,
 * por isso é validado com Zod na fronteira (`parseHologramSnapshot`).
 */
export const hologramSnapshotSchema = z
  .object({
    state: hologramStateSchema,
    context: z
      .object({
        usedTokens: z.number().int().nonnegative(),
        limitTokens: z.number().int().positive(),
      })
      .strict(),
    spend: z
      .object({
        todayUsd: z.number().nonnegative().finite(),
        limitUsd: z.number().positive().finite(),
      })
      .strict(),
    satellites: z.array(satelliteSchema).max(MAX_SATELLITES),
    pulses: z.array(pulseSchema).max(64),
    taint: taintSchema,
    subagents: z.number().int().min(0).max(MAX_SUBAGENTS),
    /** Memórias de longo prazo: cada uma vira uma estrela no fundo. */
    memoryCount: z.number().int().min(0),
    /** Código do *device flow* (ex.: GitHub) mostrado grande no centro; `null` quando não há login em curso. */
    deviceCode: z
      .string()
      .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      .nullable(),
  })
  .strict();
export type HologramSnapshot = z.infer<typeof hologramSnapshotSchema>;

export type ParseResult =
  | { ok: true; snapshot: HologramSnapshot }
  | { ok: false; error: string };

/** Valida um snapshot vindo de fora (IPC, JSON). Nunca lança: entrada inválida volta como erro. */
export function parseHologramSnapshot(input: unknown): ParseResult {
  const result = hologramSnapshotSchema.safeParse(input);
  if (result.success) return { ok: true, snapshot: result.data };
  return { ok: false, error: z.prettifyError(result.error) };
}
