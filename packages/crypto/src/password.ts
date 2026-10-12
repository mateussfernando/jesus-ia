import bcrypt from 'bcryptjs';

/**
 * Hash de senha com bcrypt (decisão 0015). Serve para conferir senhas (a senha local do Jesus e o código de
 * recuperação), nunca para cifrar dados que precisam ser lidos de volta: para isso existe `field.ts`.
 *
 * Funciona no Node e no navegador (só depende do `bcryptjs` e do `crypto.getRandomValues`), por isso é
 * exportado também como `@jesus/crypto/password`.
 */

/** O bcrypt usa só os primeiros 72 bytes da senha e ignora o resto sem avisar. */
export const BCRYPT_MAX_BYTES = 72;

/** Custo padrão (2¹² rodadas): ~0,3 a 0,5 s no `bcryptjs` num PC comum. */
export const DEFAULT_PASSWORD_COST = 12;

/** Faixa aceita pelo algoritmo. Custos baixos só servem para testes; a política de produção usa o padrão. */
export const MIN_BCRYPT_COST = 4;
export const MAX_BCRYPT_COST = 31;

const BCRYPT_HASH = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

/**
 * O bcrypt monta a chave com a senha seguida de um byte 0, repetida em ciclo até 72 bytes. Com um U+0000 no
 * meio, "senha\0senha" vira a mesma chave de "senha"; e um bcrypt em C pararia no primeiro byte 0. Surrogate
 * sozinho (texto cortado no meio de um emoji) não tem forma UTF-8 e viraria outro caractere sem avisar.
 */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** Senha com U+0000 ou com surrogate sozinho: recusada, porque o bcrypt não a conferiria do jeito esperado. */
export class PasswordCharError extends RangeError {
  constructor() {
    super('a senha tem um caractere que o bcrypt não confere direito (U+0000 ou surrogate sozinho)');
    this.name = 'PasswordCharError';
  }
}

/** A senha tem U+0000 ou surrogate sozinho (veja `PasswordCharError`). */
export function hasUnsafePasswordChar(password: string): boolean {
  return password.includes('\u0000') || LONE_SURROGATE.test(password);
}

/** Senha vazia ou acima de 72 bytes: recusada em vez de cortada (decisão 0015). */
export class PasswordLengthError extends RangeError {
  readonly reason: 'empty' | 'too_long';
  readonly bytes: number;

  constructor(reason: 'empty' | 'too_long', bytes: number) {
    super(
      reason === 'empty'
        ? 'senha vazia'
        : `senha com ${String(bytes)} bytes; o limite do bcrypt é ${String(BCRYPT_MAX_BYTES)}`,
    );
    this.name = 'PasswordLengthError';
    this.reason = reason;
    this.bytes = bytes;
  }
}

/** Normaliza para NFC: o mesmo "é" digitado de jeitos diferentes vira os mesmos bytes. */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** Tamanho em bytes UTF-8, depois da normalização (é o que o bcrypt de fato lê). */
export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(normalizePassword(password)).length;
}

function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < MIN_BCRYPT_COST || cost > MAX_BCRYPT_COST) {
    throw new RangeError(`custo do bcrypt inválido: ${String(cost)}`);
  }
}

/** Confere o formato de um hash bcrypt (`$2a$`, `$2b$` ou `$2y$`, custo de 04 a 31, 53 caracteres de sal e hash). */
export function isBcryptHash(hash: string): boolean {
  return BCRYPT_HASH.test(hash);
}

/** Custo gravado no hash, ou `null` se o texto não for um hash bcrypt válido. */
export function hashCost(hash: string): number | null {
  if (!isBcryptHash(hash)) return null;
  return Number(hash.slice(4, 6));
}

/**
 * Gera o hash bcrypt de uma senha, com sal aleatório.
 * Lança `PasswordLengthError` para senha vazia ou acima de 72 bytes: nunca corta sem avisar. Lança
 * `PasswordCharError` para senha com U+0000 ou surrogate sozinho.
 */
export async function hashPassword(password: string, options: { cost?: number } = {}): Promise<string> {
  const cost = options.cost ?? DEFAULT_PASSWORD_COST;
  assertCost(cost);
  if (hasUnsafePasswordChar(password)) throw new PasswordCharError();
  const normalized = normalizePassword(password);
  const bytes = new TextEncoder().encode(normalized).length;
  if (bytes === 0) throw new PasswordLengthError('empty', 0);
  if (bytes > BCRYPT_MAX_BYTES) throw new PasswordLengthError('too_long', bytes);
  return bcrypt.hash(normalized, cost);
}

/**
 * Confere uma senha contra um hash bcrypt. Falha fechada: hash malformado, senha vazia, acima de 72 bytes ou
 * com U+0000 ou surrogate sozinho devolvem `false` (sem lançar). As mesmas regras do `hashPassword` valem
 * aqui: sem o limite, a senha certa seguida de qualquer coisa passaria, porque o bcrypt ignora o que vem
 * depois do byte 72; sem a recusa do U+0000, passaria "senha\0senha", porque o bcrypt repete a chave em ciclo.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!isBcryptHash(hash) || hasUnsafePasswordChar(password)) return false;
  const normalized = normalizePassword(password);
  const bytes = new TextEncoder().encode(normalized).length;
  if (bytes === 0 || bytes > BCRYPT_MAX_BYTES) return false;
  try {
    return await bcrypt.compare(normalized, hash);
  } catch {
    return false;
  }
}

/** O hash foi feito com custo menor que o atual (ou está malformado) e deve ser refeito no próximo acerto. */
export function needsRehash(hash: string, cost: number = DEFAULT_PASSWORD_COST): boolean {
  assertCost(cost);
  const current = hashCost(hash);
  return current === null || current < cost;
}
