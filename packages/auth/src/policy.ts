import { BCRYPT_MAX_BYTES, normalizePassword, passwordByteLength } from '@jesus/crypto/password';

/**
 * Regras da senha local do Jesus (decisão 0015): comprimento mínimo, limite de 72 bytes do bcrypt e recusa de
 * senhas óbvias. Sem regra de composição ("maiúscula + número + símbolo"): uma frase longa é mais forte e mais
 * fácil de lembrar.
 */

export const MIN_PASSWORD_CHARS = 12;
export const RECOMMENDED_PASSWORD_CHARS = 15;

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'repetitive' | 'sequence';

export type PasswordCheck =
  | { readonly ok: true; readonly strong: boolean; readonly chars: number; readonly bytes: number }
  | { readonly ok: false; readonly problems: readonly PasswordProblem[]; readonly chars: number; readonly bytes: number };

/**
 * Lista curta de senhas comuns com 12 caracteres ou mais (as menores já caem no comprimento). Comparada sem
 * maiúsculas, espaços nem pontuação. É uma rede de segurança, não um dicionário completo.
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
  'teamo1234567', 'euteamo12345',
]);

/** Comprimento em caracteres visíveis: NFC, espaços repetidos contam como um e as pontas não contam. */
export function effectivePasswordChars(password: string): number {
  return Array.from(normalizePassword(password).replace(/\s+/gu, ' ').trim()).length;
}

function canonicalForBlocklist(password: string): string {
  return normalizePassword(password)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function isRepetitive(chars: readonly string[]): boolean {
  if (chars.length === 0) return false;
  // Um só caractere repetido, ou um bloco curto (até 3) repetido do começo ao fim ("abcabcabcabc").
  for (let block = 1; block <= 3; block++) {
    if (chars.length < block * 3) continue;
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

function isSequence(chars: readonly string[]): boolean {
  if (chars.length < 4) return false;
  const codes = chars.map((c) => c.codePointAt(0) ?? 0);
  const step = (codes[1] ?? 0) - (codes[0] ?? 0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < codes.length; i++) {
    const delta = (codes[i] ?? 0) - (codes[i - 1] ?? 0);
    // Sequência de dígitos pode dar a volta (…7890123).
    const wraps = step === 1 && codes[i - 1] === 0x39 && codes[i] === 0x30;
    if (delta !== step && !wraps) return false;
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

  const canonical = canonicalForBlocklist(password);
  const canonicalChars = Array.from(canonical);
  if (canonical.length > 0) {
    if (COMMON_PASSWORDS.has(canonical)) problems.push('common');
    else if (isRepetitive(canonicalChars)) problems.push('repetitive');
    else if (isSequence(canonicalChars)) problems.push('sequence');
  }

  if (problems.length > 0) return { ok: false, problems, chars, bytes };
  return { ok: true, strong: chars >= RECOMMENDED_PASSWORD_CHARS, chars, bytes };
}

/** Texto em pt-BR de cada problema, para a tela de senha. */
export const passwordProblemText: Readonly<Record<PasswordProblem, string>> = {
  too_short: `Use pelo menos ${String(MIN_PASSWORD_CHARS)} caracteres (${String(RECOMMENDED_PASSWORD_CHARS)} ou mais é melhor: uma frase com 4 palavras serve).`,
  too_long: `A senha passou de ${String(BCRYPT_MAX_BYTES)} bytes, o limite do bcrypt. Letras com acento ocupam 2 bytes.`,
  common: 'Essa senha está entre as mais usadas. Escolha outra.',
  repetitive: 'A senha é só um trecho repetido. Escolha outra.',
  sequence: 'A senha é uma sequência (como 123456… ou abcdef…). Escolha outra.',
};
