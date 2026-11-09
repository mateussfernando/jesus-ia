import { maskSecrets } from './mask-secrets';

/**
 * Logger com redação (invariante 5; decisão 0022): nada que passa por aqui leva segredo para o registro de texto.
 * - campo cujo nome parece de segredo (senha, token, cookie, autorização, chave de API, credencial, código de
 *   recuperação) sai inteiro, seja qual for o valor;
 * - toda string passa pelo `maskSecrets` e é cortada (2.000 caracteres por padrão);
 * - erros viram nome, mensagem e pilha, também mascarados e cortados;
 * - profundidade, quantidade de chaves e de itens têm teto;
 * - nunca lança: o registro não pode derrubar quem registra.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  /** Milissegundos desde 1970 (UTC). */
  readonly ts: number;
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Logger com campos fixos (por exemplo, o processo de origem). */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly sink: (record: LogRecord) => void;
  readonly level?: LogLevel;
  readonly now?: () => number;
  readonly maxString?: number;
}

export const REMOVED = '[removido]';
const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ITEMS = 50;
const EVENT = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/** Nome de campo de segredo: comparado sem maiúsculas, hífens, sublinhados nem espaços. */
const SECRET_KEY_PARTS = [
  'password',
  'passwd',
  'senha',
  'secret',
  'segredo',
  'token',
  'cookie',
  'authorization',
  'apikey',
  'privatekey',
  'credential',
  'credencial',
  'recovery',
  'recuperacao',
  'passphrase',
];

export function isSecretKey(name: string): boolean {
  const compact = name
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[-_\s]/g, '');
  return SECRET_KEY_PARTS.some((part) => compact.includes(part));
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[+${String(text.length - max)}]`;
}

/** Cópia redigida de um valor qualquer: só tipos do JSON, com segredos mascarados e tetos aplicados. */
export function redact(value: unknown, maxString = 2_000, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case 'string':
      return cut(maskSecrets(value).text, maxString);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return `[${typeof value}]`;
  }
  if (depth >= MAX_DEPTH) return '[profundo demais]';
  if (value instanceof Error) {
    return {
      name: cut(value.name, 100),
      message: redact(value.message, maxString, depth + 1),
      ...(value.stack === undefined ? {} : { stack: redact(value.stack, maxString, depth + 1) }),
    };
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item: unknown) => redact(item, maxString, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`[+${String(value.length - MAX_ITEMS)} itens]`);
    return items;
  }
  const result: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, item] of entries.slice(0, MAX_KEYS)) {
    const safeKey = cut(maskSecrets(key).text, 100);
    result[safeKey] = isSecretKey(key) ? REMOVED : redact(item, maxString, depth + 1);
  }
  if (entries.length > MAX_KEYS) result['…'] = `[+${String(entries.length - MAX_KEYS)} campos]`;
  return result;
}

export function createLogger(options: LoggerOptions, bound: LogFields = {}): Logger {
  const minimum = LEVELS[options.level ?? 'info'];
  const now = options.now ?? Date.now;
  const maxString = options.maxString ?? 2_000;
  const emit = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (LEVELS[level] < minimum) return;
    try {
      const redacted = redact({ ...bound, ...fields }, maxString);
      options.sink({
        ts: now(),
        level,
        event: EVENT.test(event) ? event : 'evento-invalido',
        fields: (redacted ?? {}) as Record<string, unknown>,
      });
    } catch {
      try {
        options.sink({ ts: Date.now(), level: 'error', event: 'logger.falhou', fields: {} });
      } catch {
        // Sem ter onde registrar, o registro fica de fora.
      }
    }
  };
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (fields) => createLogger(options, { ...bound, ...fields }),
  };
}

/** Uma linha JSON por registro (para arquivo). */
export function formatJsonLine(record: LogRecord): string {
  return JSON.stringify({ ts: new Date(record.ts).toISOString(), level: record.level, event: record.event, ...record.fields });
}

/** Uma linha de texto por registro (para o terminal): `[prefixo] nível evento campos`. */
export function formatTextLine(record: LogRecord, prefix: string): string {
  const fields = Object.keys(record.fields).length === 0 ? '' : ` ${JSON.stringify(record.fields)}`;
  return `[${prefix}] ${record.level} ${record.event}${fields}`;
}
