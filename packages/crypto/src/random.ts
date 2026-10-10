/**
 * Aleatoriedade e códigos de recuperação (decisão 0015). Usa só o `crypto.getRandomValues` da Web Crypto,
 * presente no Node 22+ e nos navegadores, por isso é exportado também como `@jesus/crypto/random`.
 */

/** Alfabeto base32 de Crockford: sem I, L, O e U, para não confundir na hora de anotar. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 20 caracteres de 5 bits = 100 bits de entropia. */
export const RECOVERY_CODE_CHARS = 20;
const RECOVERY_GROUP = 5;

/** Bytes aleatórios de qualidade criptográfica. */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0 || length > 65_536) {
    throw new RangeError(`tamanho inválido: ${String(length)}`);
  }
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Inteiro uniforme em [0, max), sem viés de módulo (rejeita os valores que sobram no fim da faixa). */
export function randomInt(max: number, random: (n: number) => Uint8Array = randomBytes): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError(`limite inválido: ${String(max)}`);
  const limit = Math.floor(2 ** 32 / max) * max;
  for (;;) {
    const b = random(4);
    const value = (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0;
    if (value < limit) return value % max;
  }
}

/**
 * Gera um código de recuperação de 100 bits, no formato `XXXXX-XXXXX-XXXXX-XXXXX` (base32 de Crockford).
 * `random` é injetável só para testes determinísticos.
 */
export function generateRecoveryCode(random: (n: number) => Uint8Array = randomBytes): string {
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_CHARS; i++) {
    code += CROCKFORD[randomInt(CROCKFORD.length, random)];
  }
  return groupRecoveryCode(code);
}

function groupRecoveryCode(compact: string): string {
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += RECOVERY_GROUP) groups.push(compact.slice(i, i + RECOVERY_GROUP));
  return groups.join('-');
}

/**
 * Lê um código de recuperação digitado à mão: ignora espaços e hífens, aceita minúsculas e corrige as trocas
 * previstas pelo alfabeto de Crockford (I e L → 1, O → 0). Devolve a forma compacta de 20 caracteres
 * (a que vai para o hash) ou `null` se não for um código válido.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (compact.length !== RECOVERY_CODE_CHARS) return null;
  for (const ch of compact) {
    if (!CROCKFORD.includes(ch)) return null;
  }
  return compact;
}

/** Forma de exibição (em grupos) de um código já normalizado. */
export function formatRecoveryCode(compact: string): string {
  const normalized = normalizeRecoveryCode(compact);
  if (normalized === null) throw new RangeError('código de recuperação inválido');
  return groupRecoveryCode(normalized);
}
