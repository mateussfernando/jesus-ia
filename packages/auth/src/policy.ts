import { BCRYPT_MAX_BYTES, hasUnsafePasswordChar, normalizePassword, passwordByteLength } from '@jesus/crypto/password';

/**
 * Regras da senha local do Jesus (decisão 0015): comprimento mínimo, limite de 72 bytes do bcrypt e recusa de
 * senhas óbvias. Sem regra de composição ("maiúscula + número + símbolo"): uma frase longa é mais forte e mais
 * fácil de lembrar.
 */

export const MIN_PASSWORD_CHARS = 12;
export const RECOMMENDED_PASSWORD_CHARS = 15;

export type PasswordProblem = 'too_short' | 'too_long' | 'invalid_char' | 'common' | 'repetitive' | 'sequence';

export type PasswordCheck =
  | { readonly ok: true; readonly strong: boolean; readonly chars: number; readonly bytes: number }
  | { readonly ok: false; readonly problems: readonly PasswordProblem[]; readonly chars: number; readonly bytes: number };

/**
 * Lista curta de senhas comuns com 12 caracteres ou mais (as menores já caem no comprimento). Comparada sem
 * maiúsculas e sem espaços, com e sem pontuação e símbolos. É uma rede de segurança, não um dicionário completo.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012', '1234567890123', '12345678901234', '123456789123', '123123123123', '111111111111',
  '000000000000', '123456123456', '147258369147', 'qwertyuiopas', 'qwertyuiop12', 'qwerty123456',
  'asdfghjklasd', 'zxcvbnmzxcvb', 'password1234', 'password12345', 'passwordpassword', 'iloveyou1234',
  'senhasenha12', 'senhasenha123', 'senha1234567', 'senha12345678', 'minhasenha12', 'minhasenha123',
  'minhasenhaforte', 'senhaforte123', 'mudar1234567', 'trocarsenha123', 'jesusjesus12', 'jesus1234567',
  'jesuscristo12', 'jesusmeama123', 'deuseamor123', 'deusefiel123', 'brasil123456', 'flamengo1234',
  'corinthians123', 'palmeiras1234', 'saopaulo1234', 'vasco1234567', 'gremio123456', 'internacional1',
  'administrator', 'administrador', 'welcome12345', 'letmein12345', 'abcdefghijkl', 'abc123abc123',
  'teamo1234567', 'euteamo12345', '1q2w3e4r5t6y', 'q1w2e3r4t5y6', '1qaz2wsx3edc', 'qazwsxedcrfv',
  'zaq12wsxcde3', '!@#$%^&*()_+', '!@#$%¨&*()_+', '!@#$%^&*()-=',
]);

/** Comprimento em caracteres visíveis: NFC, espaços repetidos contam como um e as pontas não contam. */
export function effectivePasswordChars(password: string): number {
  return Array.from(normalizePassword(password).replace(/\s+/gu, ' ').trim()).length;
}

/** Sem maiúsculas e sem espaços, mas com pontuação e símbolos ("!!!!" e "-_-_" continuam visíveis). */
function compactForm(password: string): string {
  return normalizePassword(password).toLowerCase().replace(/\s/gu, '');
}

/** Sem maiúsculas, espaços, pontuação nem símbolos ("Senha-Senha!" e "senha senha" ficam iguais). */
function canonicalForBlocklist(password: string): string {
  return compactForm(password).replace(/[\p{P}\p{S}]/gu, '');
}

/** Trechos curtos demais para julgar: uma senha só de símbolos com "ab" no meio não vira "repetida". */
const MIN_PATTERN_CHARS = 6;

/**
 * Um bloco de qualquer tamanho repetido pelo menos duas vezes do começo ao fim ("senha senha senha",
 * "123412341234", "abcabcab"). Conta pontos de código: emoji com tom de pele e bandeiras repetidos também caem.
 */
function isRepetitive(chars: readonly string[]): boolean {
  if (chars.length < MIN_PATTERN_CHARS) return false;
  for (let block = 1; block * 2 <= chars.length; block++) {
    let repeats = true;
    for (let i = block; i < chars.length; i++) {
      if (chars[i] !== chars[i % block]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return true;
  }
  return false;
}

/** Uma letra ou dígito só, repetido 3 vezes ou mais entre símbolos ("x!@#x$%^x&*(" vira "xxx"). */
function isOneCharRepeated(chars: readonly string[]): boolean {
  return chars.length >= 3 && new Set(chars).size === 1;
}

/** Poucos caracteres diferentes na senha inteira ("a!!!!!!!!!!!", "-_-_-_-_-_-_"). */
function hasFewDistinct(chars: readonly string[]): boolean {
  return chars.length >= MIN_PATTERN_CHARS && new Set(chars).size <= 3;
}

/** Passo entre dois caracteres; entre dígitos, 9→0 conta como +1 e 0→9 como -1 (a sequência dá a volta). */
function stepBetween(from: number, to: number): number {
  if (from === 0x39 && to === 0x30) return 1;
  if (from === 0x30 && to === 0x39) return -1;
  return to - from;
}

function isSequence(chars: readonly string[]): boolean {
  if (chars.length < 4) return false;
  const codes = chars.map((c) => c.codePointAt(0) ?? 0);
  const step = stepBetween(codes[0] ?? 0, codes[1] ?? 0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < codes.length; i++) {
    // Sequência de dígitos pode dar a volta (…7890123 ou …3210987).
    if (stepBetween(codes[i - 1] ?? 0, codes[i] ?? 0) !== step) return false;
  }
  return true;
}

/** Confere uma senha nova. Mostra todos os problemas de uma vez, para a tela explicar sem tentativa e erro. */
export function checkNewPassword(password: string): PasswordCheck {
  const chars = effectivePasswordChars(password);
  const bytes = passwordByteLength(password);
  const problems: PasswordProblem[] = [];
  if (chars < MIN_PASSWORD_CHARS) problems.push('too_short');
  if (bytes > BCRYPT_MAX_BYTES) problems.push('too_long');
  // Caracteres de controle (Tab, quebra de linha, U+0000) e surrogate sozinho: o bcrypt não os confere direito
  // ou a pessoa não consegue digitá-los de novo na tela de senha.
  if (hasUnsafePasswordChar(password) || /\p{Cc}/u.test(password)) problems.push('invalid_char');

  // Duas formas: com símbolos ("!!!!!!!!!!!!") e sem ("Senha-Senha-Senha"). Uma forma vazia não conta.
  const compact = Array.from(compactForm(password));
  const canonical = Array.from(canonicalForBlocklist(password));
  const forms = [compact, canonical].filter((form) => form.length > 0);
  if (forms.some((form) => COMMON_PASSWORDS.has(form.join('')))) problems.push('common');
  else if (hasFewDistinct(compact) || isOneCharRepeated(canonical) || forms.some(isRepetitive)) problems.push('repetitive');
  else if (forms.some(isSequence)) problems.push('sequence');

  if (problems.length > 0) return { ok: false, problems, chars, bytes };
  return { ok: true, strong: chars >= RECOMMENDED_PASSWORD_CHARS, chars, bytes };
}

/** Texto em pt-BR de cada problema, para a tela de senha. */
export const passwordProblemText: Readonly<Record<PasswordProblem, string>> = {
  too_short: `Use pelo menos ${String(MIN_PASSWORD_CHARS)} caracteres (${String(RECOMMENDED_PASSWORD_CHARS)} ou mais é melhor: uma frase com 4 palavras serve).`,
  too_long: `A senha passou de ${String(BCRYPT_MAX_BYTES)} bytes, o limite do bcrypt. Letras com acento ocupam 2 bytes.`,
  invalid_char: 'A senha tem um caractere que não dá para usar (Tab, quebra de linha ou outro caractere de controle).',
  common: 'Essa senha está entre as mais usadas. Escolha outra.',
  repetitive: 'A senha é só um trecho repetido ou usa pouquíssimos caracteres diferentes. Escolha outra.',
  sequence: 'A senha é uma sequência (como 123456… ou abcdef…). Escolha outra.',
};
