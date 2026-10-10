import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifragem de campos com AES-256-GCM (decisão 0015; seção 5.4). Para dados que o Jesus precisa ler de volta:
 * campos sensíveis do banco, backups e segredos guardados fora do cofre. Só roda no lado confiável (Node).
 *
 * Formato v1 (bytes):
 *   [0]       versão do formato (1)
 *   [1..2]    id da chave (uint16, big-endian), para trocar a chave sem perder os dados antigos
 *   [3..14]   nonce aleatório de 12 bytes (um por valor cifrado)
 *   [15..n-17] texto cifrado
 *   [n-16..]  tag de autenticação de 16 bytes
 *
 * O contexto do campo (tabela, coluna e id da linha) entra como dado autenticado: um valor cifrado copiado
 * para outra linha ou coluna não abre.
 */

export const FIELD_FORMAT_VERSION = 1;
export const DATA_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + 2 + NONCE_BYTES;
const MAX_KEY_ID = 0xffff;

export interface DataKey {
  /** 1 a 65.535. */
  readonly id: number;
  /** 32 bytes. */
  readonly bytes: Uint8Array;
}

export interface KeyRing {
  /** Chave usada para cifrar valores novos. */
  readonly current: DataKey;
  /** Chave pelo id gravado no valor cifrado (as antigas continuam abrindo os dados antigos). */
  get(id: number): DataKey | undefined;
}

/** Onde o valor mora. Vira o dado autenticado do GCM. */
export interface FieldContext {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
}

/** Erro genérico de abertura: não diz se foi a chave, o contexto, a tag ou o formato (não ajuda quem adultera). */
export class FieldDecryptError extends Error {
  constructor() {
    super('não foi possível abrir o valor cifrado');
    this.name = 'FieldDecryptError';
  }
}

function assertKey(key: DataKey): void {
  if (!Number.isInteger(key.id) || key.id < 1 || key.id > MAX_KEY_ID) {
    throw new RangeError(`id de chave inválido: ${String(key.id)}`);
  }
  if (key.bytes.length !== DATA_KEY_BYTES) {
    throw new RangeError(`a chave precisa ter ${String(DATA_KEY_BYTES)} bytes`);
  }
}

function assertContext(ctx: FieldContext): void {
  if (ctx.table.length === 0 || ctx.column.length === 0 || ctx.rowId.length === 0) {
    throw new RangeError('contexto do campo incompleto (tabela, coluna e id da linha são obrigatórios)');
  }
}

/** Dado autenticado sem ambiguidade (JSON de um array de strings) e com o nome do formato. */
export function fieldAad(ctx: FieldContext): Uint8Array {
  assertContext(ctx);
  return new TextEncoder().encode(JSON.stringify(['jesus-field', FIELD_FORMAT_VERSION, ctx.table, ctx.column, ctx.rowId]));
}

/** Gera uma chave de dados nova (32 bytes aleatórios). Ela só é guardada protegida pelo cofre (DPAPI). */
export function generateDataKey(id: number): DataKey {
  const key = { id, bytes: new Uint8Array(randomBytes(DATA_KEY_BYTES)) };
  assertKey(key);
  return key;
}

/** Monta o chaveiro: ids únicos, todas as chaves com 32 bytes, e a atual entre elas. */
export function createKeyRing(keys: readonly DataKey[], currentId: number): KeyRing {
  const byId = new Map<number, DataKey>();
  for (const key of keys) {
    assertKey(key);
    if (byId.has(key.id)) throw new RangeError(`id de chave repetido: ${String(key.id)}`);
    byId.set(key.id, { id: key.id, bytes: new Uint8Array(key.bytes) });
  }
  const current = byId.get(currentId);
  if (current === undefined) throw new RangeError(`a chave atual (${String(currentId)}) não está no chaveiro`);
  return { current, get: (id) => byId.get(id) };
}

/** Cifra um valor (texto em UTF-8 ou bytes) com a chave atual do chaveiro ou com a chave dada. */
export function sealField(plain: string | Uint8Array, key: DataKey | KeyRing, ctx: FieldContext): Uint8Array {
  const dataKey = 'current' in key ? key.current : key;
  assertKey(dataKey);
  const aad = fieldAad(ctx);
  const plainBytes = typeof plain === 'string' ? new TextEncoder().encode(plain) : plain;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dataKey.bytes, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  const out = new Uint8Array(HEADER_BYTES + body.length + TAG_BYTES);
  out[0] = FIELD_FORMAT_VERSION;
  out[1] = (dataKey.id >>> 8) & 0xff;
  out[2] = dataKey.id & 0xff;
  out.set(nonce, 3);
  out.set(body, HEADER_BYTES);
  out.set(tag, HEADER_BYTES + body.length);
  return out;
}

/** Id da chave gravado num valor cifrado (para saber quais valores ainda usam uma chave antiga). */
export function sealedKeyId(sealed: Uint8Array): number | null {
  if (sealed.length < HEADER_BYTES + TAG_BYTES || sealed[0] !== FIELD_FORMAT_VERSION) return null;
  return ((sealed[1] ?? 0) << 8) | (sealed[2] ?? 0);
}

/** Abre um valor cifrado. Qualquer problema (formato, chave, contexto, adulteração) lança `FieldDecryptError`. */
export function openField(sealed: Uint8Array, ring: KeyRing, ctx: FieldContext): Uint8Array {
  const keyId = sealedKeyId(sealed);
  if (keyId === null) throw new FieldDecryptError();
  const key = ring.get(keyId);
  if (key === undefined) throw new FieldDecryptError();
  let aad: Uint8Array;
  try {
    aad = fieldAad(ctx);
  } catch {
    throw new FieldDecryptError();
  }
  const nonce = sealed.subarray(3, HEADER_BYTES);
  const body = sealed.subarray(HEADER_BYTES, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.bytes, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    throw new FieldDecryptError();
  }
}

/** Abre um valor cifrado que guardava texto. */
export function openFieldText(sealed: Uint8Array, ring: KeyRing, ctx: FieldContext): string {
  const bytes = openField(sealed, ring, ctx);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FieldDecryptError();
  }
}
