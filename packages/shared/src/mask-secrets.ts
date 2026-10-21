/**
 * Mascaramento de segredos (seção 3.5, invariante 5; decisão 0022). Roda antes de qualquer texto ir para o modelo, para
 * o registro, para o logger ou para a memória. Cobre:
 * - chaves com prefixo conhecido (Anthropic, OpenAI, GitHub, Google, Slack, AWS, Stripe, npm, Hugging Face, Groq, xAI);
 * - `Bearer`/`Basic`/`Token` seguidos do token; JWT; chave privada em PEM; senha dentro de URL de conexão;
 * - senha por atribuição (`senha: x`, `password=x`) e por proximidade (palavra-chave a até 6 palavras antes de um valor
 *   que parece senha: com dígito ou símbolo);
 * - código de verificação (4 a 8 dígitos perto de "código", "2FA", "OTP"…), código de login do device flow
 *   (`XXXX-XXXX` perto de "código", "device", "GitHub"), código de segurança do cartão;
 * - número de cartão que passa no Luhn (fica só o final: `[cartão •••• 1234]`);
 * - token de alta entropia (24 caracteres ou mais, com letra e dígito, entropia de Shannon de 4 bits por caractere ou
 *   mais) e base64 com barra (40 caracteres ou mais: a chave secreta da AWS, o corpo de uma chave PEM sem o cabeçalho).
 * A frase-semente (BIP-39) fica para a memória automática, que precisa das listas de palavras.
 *
 * Idempotente por construção: o texto é mascarado de novo até nenhuma regra achar nada (as marcas já postas são
 * protegidas), então mascarar o resultado não muda nada.
 *
 * O custo cresce em linha com o tamanho do texto, mesmo com milhares de achados: o Executor mascara arquivos inteiros
 * (até alguns MB), e um arquivo cheio de "senhas" não pode prender o processo.
 */

export type SecretKind =
  | 'private_key'
  | 'jwt'
  | 'api_key'
  | 'connection_string'
  | 'bearer'
  | 'card_pan'
  | 'cvv'
  | 'password'
  | 'device_code'
  | 'otp'
  | 'high_entropy';

export interface MaskResult {
  /** O texto com cada segredo trocado por uma marca (`[segredo removido: …]` ou `[cartão •••• 1234]`). */
  readonly text: string;
  /** Um item por trecho mascarado, na ordem do texto. Nunca leva o valor. */
  readonly findings: readonly SecretKind[];
  /** Quantos caracteres do texto original foram mascarados. */
  readonly maskedChars: number;
}

export interface MaskOptions {
  /** Só estas regras (padrão: todas). */
  readonly kinds?: readonly SecretKind[];
  /**
   * Mantém as quebras de linha de um trecho mascarado (a chave privada de várias linhas vira a marca e as mesmas
   * quebras), para a numeração das linhas de um arquivo continuar certa.
   */
  readonly keepLines?: boolean;
}

/**
 * As regras que quase nunca erram, para nomes de arquivo e de pasta: as outras (senha por proximidade, código, cartão,
 * alta entropia) pegariam nomes comuns, como `Screenshot_2023-10-15-12-34-56-789_com.whatsapp.jpg` ou
 * `relatorio_final_v2_2023-10-15_revisado_marcos.docx`, e o nome mascarado não abre mais o arquivo.
 */
export const HIGH_CONFIDENCE_SECRETS: readonly SecretKind[] = Object.freeze(['private_key', 'jwt', 'api_key', 'connection_string']);

const LABELS: Readonly<Record<Exclude<SecretKind, 'card_pan'>, string>> = {
  private_key: 'chave privada',
  jwt: 'token',
  api_key: 'chave de API',
  connection_string: 'senha de conexão',
  bearer: 'token',
  cvv: 'código de segurança do cartão',
  password: 'senha',
  device_code: 'código de login',
  otp: 'código de verificação',
  high_entropy: 'token',
};

/** Marcas já postas: nenhuma regra mascara de novo dentro delas. */
const MARK = /\[segredo removido: [^\]\n]{1,40}\]|\[cartão •••• \d{4}\]/g;

interface Candidate {
  readonly kind: SecretKind;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

type Detector = (text: string, protectedAt: (start: number, end: number) => boolean) => Candidate[];

function mark(kind: Exclude<SecretKind, 'card_pan'>): string {
  return `[segredo removido: ${LABELS[kind]}]`;
}

function candidate(kind: Exclude<SecretKind, 'card_pan'>, start: number, end: number): Candidate {
  return { kind, start, end, replacement: mark(kind) };
}

/** Todas as ocorrências de uma regex global, com a posição do grupo `group` (ou do trecho inteiro). */
function* matches(pattern: RegExp, text: string, group?: number): Generator<{ start: number; end: number; match: RegExpExecArray }> {
  const regex = new RegExp(pattern.source, pattern.flags.includes('d') ? pattern.flags : `${pattern.flags}d`);
  for (const match of text.matchAll(regex)) {
    const span = group === undefined ? match.indices?.[0] : match.indices?.[group];
    if (span !== undefined) yield { start: span[0], end: span[1], match };
  }
}

const NOT_TOKEN_BEFORE = '(?<![A-Za-z0-9_\\-])';

const PREFIXED_KEYS: readonly RegExp[] = [
  new RegExp(`${NOT_TOKEN_BEFORE}sk-ant-[A-Za-z0-9_\\-]{20,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}sk-(?:proj-|svcacct-|admin-|or-v1-)?[A-Za-z0-9_\\-]{20,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}github_pat_[A-Za-z0-9_]{40,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}AIza[0-9A-Za-z_\\-]{35}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}GOCSPX-[A-Za-z0-9_\\-]{20,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}ya29\\.[0-9A-Za-z_\\-]{20,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}xox[abprs]-[A-Za-z0-9\\-]{10,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}xapp-[A-Za-z0-9\\-]{10,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}whsec_[0-9A-Za-z]{20,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}npm_[A-Za-z0-9]{36,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}hf_[A-Za-z0-9]{30,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}gsk_[A-Za-z0-9]{40,}`, 'g'),
  new RegExp(`${NOT_TOKEN_BEFORE}xai-[A-Za-z0-9]{40,}`, 'g'),
];

const detectPrivateKeys: Detector = (text) =>
  [...matches(/-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g, text)].map((m) =>
    candidate('private_key', m.start, m.end),
  );

const detectJwt: Detector = (text) =>
  [...matches(new RegExp(`${NOT_TOKEN_BEFORE}eyJ[A-Za-z0-9_\\-]{5,}\\.eyJ[A-Za-z0-9_\\-]{5,}\\.[A-Za-z0-9_\\-]*`, 'g'), text)].map((m) =>
    candidate('jwt', m.start, m.end),
  );

const detectApiKeys: Detector = (text) =>
  PREFIXED_KEYS.flatMap((pattern) => [...matches(pattern, text)].map((m) => candidate('api_key', m.start, m.end)));

/** `esquema://usuário:senha@`: só a senha sai. */
const detectConnectionStrings: Detector = (text) =>
  [...matches(/\b[a-z][a-z0-9+.-]{1,30}:\/\/[^\s:/@]{1,256}:([^\s@/]{1,256})@/gi, text, 1)].map((m) =>
    candidate('connection_string', m.start, m.end),
  );

const detectBearer: Detector = (text) =>
  [...matches(/\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{16,})/gi, text, 1)].map((m) => candidate('bearer', m.start, m.end));

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const detectCards: Detector = (text) => {
  const found: Candidate[] = [];
  for (const m of matches(/(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g, text)) {
    const digits = text.slice(m.start, m.end).replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue;
    found.push({ kind: 'card_pan', start: m.start, end: m.end, replacement: `[cartão •••• ${digits.slice(-4)}]` });
  }
  return found;
};

const detectCvv: Detector = (text) =>
  [...matches(/\b(?:cvv2?|cvc|c[óo]digo de seguran[çc]a|security code)\b[^\d\n]{0,20}(?<!\d)(\d{3,4})(?!\d)/gi, text, 1)].map((m) =>
    candidate('cvv', m.start, m.end),
  );

const PASSWORD_WORDS = 'senhas?|password|passwd|pwd|pin|passcode|c[óo]digo de acesso|chave|token|segredo|secret|frase de recupera[çc][ãa]o|api[_\\- ]?key';

/** `senha: valor`, `password=valor`, `"apiKey": "valor"`: o valor sai, seja qual for a forma dele. */
const detectAssignedPasswords: Detector = (text, protectedAt) => {
  const pattern = new RegExp(`(?:${PASSWORD_WORDS})["']?\\s{0,3}[:=]\\s{0,3}("[^"\\n]{1,256}"|'[^'\\n]{1,256}'|[^\\s,;&]{1,256})`, 'gi');
  const found: Candidate[] = [];
  for (const m of matches(pattern, text, 1)) {
    let { start, end } = m;
    const value = text.slice(start, end);
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) {
      start += 1;
      end -= 1;
    }
    if (end - start < 1 || protectedAt(start, end)) continue;
    found.push(candidate('password', start, end));
  }
  return found;
};

/** Valor que parece senha: 4 caracteres ou mais, com dígito ou com um símbolo que não seja só hífen entre letras. */
function looksLikePassword(token: string): boolean {
  if (token.length < 4) return false;
  if (/\d/.test(token)) return true;
  return /[!@#$%^&*()_+=[\]{};:'"\\|,.<>/?`~]/.test(token);
}

/** Palavra-chave a até 6 palavras antes do primeiro valor que parece senha ("a senha do Wi-Fi é Abc123!xyz"). */
const detectNearbyPasswords: Detector = (text, protectedAt) => {
  const found: Candidate[] = [];
  const keyword = new RegExp(`\\b(?:${PASSWORD_WORDS})\\b`, 'gi');
  for (const k of matches(keyword, text)) {
    const word = /\S+/g;
    word.lastIndex = k.end;
    for (let count = 0; count < 6; count++) {
      const next = word.exec(text);
      if (next === null) break;
      // Quebra de parágrafo encerra a busca.
      if (/\n\s*\n/.test(text.slice(k.end, next.index))) break;
      let start = next.index;
      let end = start + next[0].length;
      // Pontuação de frase no fim não faz parte do valor.
      while (end > start && /[.,;:)]/.test(text.charAt(end - 1))) end -= 1;
      if (protectedAt(start, end)) break;
      const token = text.slice(start, end).replace(/^["'(]+/, () => '');
      start = end - token.length;
      if (looksLikePassword(token)) {
        found.push(candidate('password', start, end));
        break;
      }
    }
  }
  return found;
};

const detectDeviceCodes: Detector = (text) =>
  [...matches(/\b(?:c[óo]digo|code|device|github|login)\b[^\n]{0,30}?(?<![A-Za-z0-9])([A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Za-z0-9])/gi, text, 1)]
    .filter((m) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(m.match[1] ?? ''))
    .map((m) => candidate('device_code', m.start, m.end));

const detectOtp: Detector = (text) =>
  [...matches(/\b(?:c[óo]digo|code|2fa|verifica[çc][ãa]o|otp|sms|token)\b[^\d\n]{0,30}(?<!\d)(\d{4,8})(?!\d)/gi, text, 1)].map((m) =>
    candidate('otp', m.start, m.end),
  );

function shannonEntropy(token: string): number {
  const counts = new Map<string, number>();
  for (const char of token) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / token.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Sem `/`: caminhos de arquivo e URLs não são tokens. */
const detectHighEntropy: Detector = (text) => {
  const found: Candidate[] = [];
  for (const m of matches(/(?<![A-Za-z0-9+=_-])[A-Za-z0-9+=_-]{24,}(?![A-Za-z0-9+=_-])/g, text)) {
    const token = text.slice(m.start, m.end);
    if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
    // Hash ou identificador em hexadecimal (com ou sem os hífens do UUID): não passa de 4 bits por caractere de verdade,
    // e chave hexadecimal só é pega pela atribuição ou pela proximidade.
    if (/^[0-9a-f-]+$/i.test(token)) continue;
    if (shannonEntropy(token) >= 4) found.push(candidate('high_entropy', m.start, m.end));
  }
  return found;
};

/**
 * Base64 com barra, que a regra de cima não pega (a barra a separa, para caminhos e URLs não virarem token): a chave
 * secreta da AWS (40 caracteres) e as linhas do corpo de uma chave PEM vista sem o cabeçalho (um pedaço do arquivo, um
 * resultado de busca). Para não pegar caminhos: maiúscula, minúscula e dígito, no máximo uma barra a cada 16
 * caracteres e entropia de 4,5 bits por caractere ou mais.
 */
const detectBase64WithSlash: Detector = (text) => {
  const found: Candidate[] = [];
  for (const m of matches(/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=_-])/g, text)) {
    const token = text.slice(m.start, m.end).replace(/=+$/, '');
    const slashes = token.split('/').length - 1;
    if (slashes === 0 || slashes * 16 > token.length) continue;
    if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/\d/.test(token)) continue;
    if (shannonEntropy(token) >= 4.5) found.push(candidate('high_entropy', m.start, m.end));
  }
  return found;
};

interface Rule {
  readonly kinds: readonly SecretKind[];
  readonly detect: Detector;
}

/** Na ordem de prioridade: num conflito, a regra mais específica fica com o trecho. */
const RULES: readonly Rule[] = [
  { kinds: ['private_key'], detect: detectPrivateKeys },
  { kinds: ['jwt'], detect: detectJwt },
  { kinds: ['api_key'], detect: detectApiKeys },
  { kinds: ['connection_string'], detect: detectConnectionStrings },
  { kinds: ['bearer'], detect: detectBearer },
  { kinds: ['card_pan'], detect: detectCards },
  { kinds: ['cvv'], detect: detectCvv },
  { kinds: ['password'], detect: detectAssignedPasswords },
  { kinds: ['password'], detect: detectNearbyPasswords },
  { kinds: ['device_code'], detect: detectDeviceCodes },
  { kinds: ['otp'], detect: detectOtp },
  // Antes da regra de alta entropia: senão ela pegaria só um pedaço entre barras, e o resto sobraria.
  { kinds: ['high_entropy'], detect: detectBase64WithSlash },
  { kinds: ['high_entropy'], detect: detectHighEntropy },
];

type Span = readonly [start: number, end: number];

/** Algum trecho de `sorted` (ordenados e sem sobreposição) cruza `[start, end)`. Busca binária. */
function overlaps(sorted: readonly Span[], start: number, end: number): boolean {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle]?.[1] ?? 0) <= start) low = middle + 1;
    else high = middle;
  }
  const first = sorted[low];
  return first !== undefined && first[0] < end;
}

/** Junta duas listas ordenadas pelo início. */
function merge(a: readonly Candidate[], b: readonly Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (right === undefined || (left !== undefined && left.start <= right.start)) {
      if (left !== undefined) out.push(left);
      i += 1;
    } else {
      out.push(right);
      j += 1;
    }
  }
  return out;
}

function maskOnce(text: string, rules: readonly Rule[], keepLines: boolean): { text: string; findings: SecretKind[]; maskedChars: number } {
  const marks: Span[] = [...text.matchAll(MARK)].map((m) => [m.index, m.index + m[0].length] as const);
  const protectedAt = (start: number, end: number) => overlaps(marks, start, end);
  // Os trechos escolhidos, sempre ordenados e sem sobreposição: cada regra só fica com o que as anteriores deixaram.
  let chosen: Candidate[] = [];
  for (const rule of rules) {
    const spans: Span[] = chosen.map((found) => [found.start, found.end] as const);
    const accepted: Candidate[] = [];
    let lastEnd = -1;
    const found = rule.detect(text, protectedAt).sort((a, b) => a.start - b.start);
    for (const item of found) {
      if (item.end <= item.start || item.start < lastEnd || protectedAt(item.start, item.end)) continue;
      if (overlaps(spans, item.start, item.end)) continue;
      accepted.push(item);
      lastEnd = item.end;
    }
    if (accepted.length > 0) chosen = merge(chosen, accepted);
  }
  let output = '';
  let cursor = 0;
  let maskedChars = 0;
  for (const found of chosen) {
    const breaks = keepLines ? text.slice(found.start, found.end).split('\n').length - 1 : 0;
    output += text.slice(cursor, found.start) + found.replacement + '\n'.repeat(breaks);
    maskedChars += found.end - found.start;
    cursor = found.end;
  }
  output += text.slice(cursor);
  return { text: output, findings: chosen.map((found) => found.kind), maskedChars };
}

/** Teto de passadas: cada uma só troca texto ainda não mascarado por marcas protegidas, então o laço termina antes. */
const MAX_PASSES = 16;

export function maskSecrets(text: string, options: MaskOptions = {}): MaskResult {
  const kinds = options.kinds;
  const rules = kinds === undefined ? RULES : RULES.filter((rule) => rule.kinds.some((kind) => kinds.includes(kind)));
  const keepLines = options.keepLines ?? false;
  let current = text;
  const findings: SecretKind[] = [];
  let maskedChars = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const result = maskOnce(current, rules, keepLines);
    if (result.findings.length === 0) break;
    current = result.text;
    findings.push(...result.findings);
    maskedChars += result.maskedChars;
  }
  return { text: current, findings, maskedChars };
}
