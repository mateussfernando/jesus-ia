/**
 * Texto de arquivo: a codificação (UTF-8, UTF-16 com marca e, para arquivos antigos do Windows, Windows-1252), a
 * recusa de binários e os cortes que nunca partem um par de surrogates (metade solta faria a saída para a API recusar o
 * pedido inteiro).
 */

/** Bytes olhados para achar binário (um byte zero), como o Git faz. */
const BINARY_PROBE = 8_192;

export type Decoded = { readonly ok: true; readonly text: string } | { readonly ok: false };

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/** Onde terminam os caracteres UTF-8 inteiros: tira uma sequência cortada no fim. */
function utf8Boundary(bytes: Uint8Array): number {
  let index = bytes.length - 1;
  let continuation = 0;
  while (index >= 0 && continuation < 3 && ((bytes[index] ?? 0) & 0xc0) === 0x80) {
    index -= 1;
    continuation += 1;
  }
  if (index < 0) return bytes.length;
  const lead = bytes[index] ?? 0;
  const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return continuation + 1 < length ? index : bytes.length;
}

/** Quebras de linha do Windows e do Mac antigo viram `\n`; num pedaço do arquivo, a última linha (talvez cortada) sai. */
function finish(text: string, partial: boolean): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!partial) return normalized;
  const end = normalized.lastIndexOf('\n');
  return end === -1 ? normalized : normalized.slice(0, end + 1);
}

/**
 * `partial`: os bytes são o começo de um arquivo maior (o corte pode ter partido um caractere ou uma linha).
 * Binário (um byte zero no começo, ou UTF-32) não é decodificado.
 */
export function decodeText(bytes: Uint8Array, partial: boolean): Decoded {
  if (startsWith(bytes, [0xff, 0xfe, 0x00, 0x00]) || startsWith(bytes, [0x00, 0x00, 0xfe, 0xff])) return { ok: false };
  if (startsWith(bytes, [0xff, 0xfe])) return { ok: true, text: finish(new TextDecoder('utf-16le').decode(bytes.subarray(2)), partial) };
  if (startsWith(bytes, [0xfe, 0xff])) return { ok: true, text: finish(new TextDecoder('utf-16be').decode(bytes.subarray(2)), partial) };
  let body = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
  if (body.subarray(0, BINARY_PROBE).includes(0)) return { ok: false };
  if (partial) body = body.subarray(0, utf8Boundary(body));
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    // Não é UTF-8: arquivo antigo do Windows (o Bloco de Notas antes de 2019, planilhas exportadas em CSV).
    text = new TextDecoder('windows-1252').decode(body);
  }
  return { ok: true, text: finish(text, partial) };
}

/** As linhas de um texto com `\n` (a quebra do fim não abre uma linha a mais). */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** `text.slice(start, end)` sem partir um par de surrogates nas pontas. */
export function safeSlice(text: string, start: number, end: number): string {
  let from = Math.max(0, start);
  let to = Math.min(text.length, end);
  if (from > 0 && from < text.length && isLow(text.charCodeAt(from)) && isHigh(text.charCodeAt(from - 1))) from += 1;
  if (to > 0 && to < text.length && isHigh(text.charCodeAt(to - 1)) && isLow(text.charCodeAt(to))) to -= 1;
  return from >= to ? '' : text.slice(from, to);
}

/** Linha longa demais: o começo e um aviso com o tamanho. */
export function cutLine(line: string, max: number): string {
  if (line.length <= max) return line;
  return `${safeSlice(line, 0, max)} … [linha cortada: ${formatCount(line.length)} caracteres]`;
}

/** Para comparar na busca: a mesma forma Unicode e sem maiúsculas. */
export function fold(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/** `12345` → `12.345`. */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Tamanho como o Explorador do Windows mostra: `512 bytes`, `2,3 KB`, `15 MB`. */
export function formatSize(bytes: bigint | number): string {
  const total = Number(bytes);
  if (total < 1024) return `${total} ${total === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = total / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${rounded} ${units[unit] ?? 'TB'}`;
}

/** Nome de arquivo para mostrar: controles, invisíveis e metade solta de surrogate (que não deveriam estar num nome) viram U+FFFD. */
export function displayName(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const hidden =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x2064) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff ||
      (code >= 0xd800 && code <= 0xdfff) ||
      (code >= 0xe0000 && code <= 0xe007f);
    out += hidden ? '\uFFFD' : char;
  }
  return out;
}
