import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../canonical-json';
import { redact } from '../logger';

/**
 * Cadeia do registro de auditoria (seções 3.13 e 3.16; decisão 0022). Cada linha do arquivo JSONL é o JSON canônico de
 * uma entrada `{ v, seq, ts, prev, event, hash }`, em que `hash` é o SHA-256 do JSON canônico da entrada sem ele e
 * `prev` é o `hash` da anterior. Mudar, tirar ou trocar a ordem de uma linha quebra a cadeia daí em diante.
 *
 * O que a cadeia sozinha não pega: cortar o fim do arquivo ou reescrevê-lo inteiro (com os hashes refeitos). Para isso
 * existe a âncora: `{ seq, hash }` da última entrada, guardada fora do arquivo (no cofre, a partir da etapa 8). A
 * conferência compara o fim do arquivo com ela.
 */

export const AUDIT_VERSION = 1;
/** `prev` da primeira entrada de um registro novo. */
export const GENESIS = '0'.repeat(64);

const HASH = z.string().regex(/^[0-9a-f]{64}$/);
const EVENT_TYPE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/** Evento registrado: o tipo (`ferramenta.leitura`, `audit.chain_broken`) e os campos, todos do JSON canônico. */
export interface AuditEvent {
  readonly type: string;
  readonly [field: string]: unknown;
}

export interface AuditEntry {
  readonly v: typeof AUDIT_VERSION;
  readonly seq: number;
  /** Milissegundos desde 1970 (UTC), do relógio de parede de quem gravou (não precisa crescer). */
  readonly ts: number;
  readonly prev: string;
  readonly event: AuditEvent;
  readonly hash: string;
}

export interface AuditAnchor {
  readonly seq: number;
  readonly hash: string;
}

const EntrySchema = z.strictObject({
  v: z.literal(AUDIT_VERSION),
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  prev: HASH,
  event: z.looseObject({ type: z.string().regex(EVENT_TYPE).max(64) }),
  hash: HASH,
});

export const AnchorSchema = z.strictObject({ seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), hash: HASH });

export function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonicalJson(entry)).digest('hex');
}

/**
 * Campos do evento prontos para o registro: segredos mascarados e campos de segredo removidos (como no logger), e o
 * que o JSON canônico não aceita (fração, `NaN`) vira texto.
 */
export function toAuditEvent(event: AuditEvent): AuditEvent {
  if (!EVENT_TYPE.test(event.type) || event.type.length > 64) throw new Error(`tipo de evento de auditoria inválido: ${event.type}`);
  const integersOnly = (value: unknown): unknown => {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : String(value);
    if (Array.isArray(value)) return value.map(integersOnly);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, integersOnly(item)]));
    }
    return value;
  };
  const { type, ...fields } = event;
  return { ...(integersOnly(redact(fields)) as Record<string, unknown>), type };
}

/** A próxima entrada da cadeia, depois de `previous` (ou a primeira, com `previous` nulo). */
export function nextEntry(previous: AuditAnchor | null, event: AuditEvent, ts: number): AuditEntry {
  const body = { v: AUDIT_VERSION, seq: (previous?.seq ?? 0) + 1, ts, prev: previous?.hash ?? GENESIS, event } as const;
  return { ...body, hash: hashEntry(body) };
}

export function serializeEntry(entry: AuditEntry): string {
  return canonicalJson(entry);
}

export function parseEntry(line: string): AuditEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const result = EntrySchema.safeParse(raw);
  return result.success ? (result.data as AuditEntry) : null;
}

/** Evento que começa um registro novo depois de um quebrado: ele se liga à âncora boa que havia. */
export const CHAIN_BROKEN = 'audit.chain_broken';

export type ChainStatus =
  /** A cadeia está inteira e o fim bate com a âncora (ou não há nada, nem âncora). */
  | 'ok'
  /** A cadeia está inteira e vai além da âncora (o app caiu entre gravar a linha e a âncora). */
  | 'ahead'
  /** O arquivo acaba antes da âncora: tiraram linhas do fim (ou o arquivo inteiro). */
  | 'truncated'
  /** Uma linha não confere (conteúdo, ordem, encadeamento) ou o fim não bate com a âncora. */
  | 'tampered'
  /** Há linhas, mas nenhuma âncora: o registro pode ter sido trocado inteiro. */
  | 'anchor_missing';

export interface ChainVerdict {
  readonly status: ChainStatus;
  /** Última entrada válida (nula se não há nenhuma). */
  readonly last: AuditAnchor | null;
  readonly entries: number;
  /** Bytes do começo do arquivo até a última linha válida, com a quebra de linha. */
  readonly validBytes: number;
  /** O fim do arquivo é uma linha sem quebra (gravação interrompida): fica de fora e é cortado. */
  readonly tornTail: boolean;
  /** Na cadeia quebrada: a linha (contando de 1) e o motivo. */
  readonly problem?: { readonly line: number; readonly reason: string };
}

/**
 * Confere o conteúdo inteiro do arquivo contra a âncora. `visit` recebe cada entrada que passou na conferência, na
 * ordem (as do começo, até a primeira linha quebrada): o processo principal soma ali o gasto do dia.
 */
export function verifyChain(content: string, anchor: AuditAnchor | null, visit?: (entry: AuditEntry) => void): ChainVerdict {
  const lastNewline = content.lastIndexOf('\n');
  const complete = lastNewline < 0 ? '' : content.slice(0, lastNewline);
  const tornTail = content.length > lastNewline + 1;
  const lines = complete === '' ? [] : complete.split('\n');

  let last: AuditAnchor | null = null;
  let validBytes = 0;
  let hashAtAnchorSeq: string | null = null;
  const broken = (line: number, reason: string): ChainVerdict => ({
    status: 'tampered',
    last,
    entries: line - 1,
    validBytes,
    tornTail,
    problem: { line, reason },
  });

  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    const entry = parseEntry(line);
    if (entry === null) return broken(number, 'linha que não é uma entrada válida');
    if (line !== serializeEntry(entry)) return broken(number, 'linha fora da forma canônica');
    const { hash, ...body } = entry;
    if (hashEntry(body) !== hash) return broken(number, 'hash não confere com o conteúdo');
    if (last === null) {
      // A primeira entrada começa do zero ou religa um registro quebrado à âncora boa que havia.
      const fresh = entry.seq === 1 && entry.prev === GENESIS;
      if (!fresh && entry.event.type !== CHAIN_BROKEN) return broken(number, 'o registro não começa do início');
    } else {
      if (entry.seq !== last.seq + 1) return broken(number, 'sequência fora de ordem');
      if (entry.prev !== last.hash) return broken(number, 'encadeamento quebrado');
    }
    last = { seq: entry.seq, hash };
    visit?.(entry);
    if (anchor !== null && entry.seq === anchor.seq) hashAtAnchorSeq = hash;
    validBytes += Buffer.byteLength(line, 'utf8') + 1;
  }

  const entries = lines.length;
  const verdict = (status: ChainStatus, problem?: ChainVerdict['problem']): ChainVerdict => ({
    status,
    last,
    entries,
    validBytes,
    tornTail,
    ...(problem === undefined ? {} : { problem }),
  });
  if (anchor === null) return verdict(last === null ? 'ok' : 'anchor_missing');
  if (last === null || last.seq < anchor.seq) return verdict('truncated');
  if (hashAtAnchorSeq !== anchor.hash) return verdict('tampered', { line: anchor.seq, reason: 'a entrada da âncora não confere' });
  return verdict(last.seq === anchor.seq ? 'ok' : 'ahead');
}
