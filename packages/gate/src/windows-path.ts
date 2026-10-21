/**
 * Caminhos do Windows conferidos só pelo texto (decisão 0021; seção 3.4.2). Nada aqui toca o disco: quem lê arquivos
 * (o Executor) resolve o caminho real e entrega os fatos, e o Porteiro decide com o caminho pedido e com o real.
 *
 * A regra é recusar o que é ambíguo, em vez de tentar adivinhar o que o Windows faria: prefixos `\\?\` e `\\.\`,
 * caminhos de rede, fluxos alternativos (`arquivo:fluxo`), nomes terminados em ponto ou espaço (o Windows os corta),
 * nomes de dispositivo (`CON`, `NUL.txt`) e nomes curtos 8.3 (`PROGRA~1`), que só o disco sabe para onde apontam.
 */

export type PathProblem =
  | 'empty'
  | 'too_long'
  /** Caractere de controle ou formatação invisível (direção do texto, largura zero): o nome na tela não seria o real. */
  | 'control_char'
  /** `< > " | ? *` ou metade solta de um par de surrogates. */
  | 'invalid_char'
  /** Relativo (`pasta\arquivo`), relativo à unidade (`C:pasta`) ou à raiz da unidade atual (`\pasta`). */
  | 'not_absolute'
  /** Caminho de rede (`\\servidor\pasta`): ler dispararia acesso à rede (WebDAV, SMB). */
  | 'unc'
  /** `\\?\`, `\\.\` ou `\??\`: o Windows não normaliza o resto, ou é um dispositivo. */
  | 'device_namespace'
  /** Dois-pontos fora da unidade: fluxo alternativo do NTFS (`arquivo.txt:escondido`). */
  | 'stream'
  /** Nome terminado em ponto ou espaço: o Windows o corta, e `a.txt.` abriria `a.txt`. */
  | 'trailing_dot_space'
  /** Nome de dispositivo (`CON`, `NUL`, `COM1`, `LPT1`…), com ou sem extensão. */
  | 'reserved_name'
  /** Nome curto 8.3 (`PROGRA~1`): só o disco sabe para onde aponta. */
  | 'short_name';

export interface WindowsPath {
  /** Caminho absoluto normalizado: `C:\pasta\arquivo.txt` (unidade maiúscula, `\`, sem `.` nem `..`). */
  readonly text: string;
  /** A unidade, maiúscula. */
  readonly drive: string;
  /** Os nomes depois da unidade, como vieram. */
  readonly parts: readonly string[];
  /** A unidade e os nomes com a caixa dobrada, para comparar como o NTFS compara. */
  readonly folded: readonly string[];
}

export type ParsedPath = { readonly ok: true; readonly path: WindowsPath } | { readonly ok: false; readonly problem: PathProblem };

/** Maior caminho aceito (caracteres). O Windows chega a 32 mil, mas um caminho desse tamanho não é de uso normal. */
export const MAX_PATH_CHARS = 4_096;
/** Maior nome (o NTFS aceita até 255). */
export const MAX_NAME_CHARS = 255;

const HIDDEN_FORMAT = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const INVALID_IN_NAME = /[<>"|?*]/;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³]|CONIN\$|CONOUT\$)$/i;
const SHORT_BASE = /^[^~.]{1,6}~[0-9]{1,6}$/;

/** Caractere de controle (abaixo do espaço, ou o DEL). */
function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Compara nomes como o NTFS: sem diferenciar maiúsculas e minúsculas, letra por letra. O `toUpperCase` sozinho troca
 * `ß` por `SS` e faria `Straße` e `STRASSE` parecerem a mesma pasta, o que o NTFS não faz; aqui, só vale a troca de um
 * caractere por um.
 */
export function foldCase(text: string): string {
  let out = '';
  for (const char of text) {
    const upper = char.toUpperCase();
    out += upper.length === char.length ? upper : char;
  }
  return out;
}

function nameProblem(name: string): PathProblem | null {
  if (name.length > MAX_NAME_CHARS) return 'too_long';
  if (name.includes(':')) return 'stream';
  if (INVALID_IN_NAME.test(name)) return 'invalid_char';
  if (name.endsWith('.') || name.endsWith(' ')) return 'trailing_dot_space';
  // O Windows olha o nome antes do primeiro ponto, sem os espaços do fim: `nul.tar.gz` e `CON .txt` são dispositivos.
  const stem = (name.split('.')[0] ?? '').replace(/ +$/, '');
  if (RESERVED.test(stem)) return 'reserved_name';
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  const extension = dot === -1 ? '' : name.slice(dot + 1);
  if (base.length <= 8 && extension.length <= 3 && SHORT_BASE.test(base)) return 'short_name';
  return null;
}

function build(drive: string, parts: readonly string[]): WindowsPath {
  return {
    text: `${drive}:\\${parts.join('\\')}`,
    drive,
    parts: Object.freeze([...parts]),
    folded: Object.freeze([drive, ...parts.map(foldCase)]),
  };
}

export function parseWindowsPath(input: string): ParsedPath {
  const fail = (problem: PathProblem): ParsedPath => ({ ok: false, problem });
  if (input.length === 0) return fail('empty');
  if (input.length > MAX_PATH_CHARS) return fail('too_long');
  if (hasControl(input) || HIDDEN_FORMAT.test(input)) return fail('control_char');
  if (LONE_SURROGATE.test(input)) return fail('invalid_char');
  const text = input.replaceAll('/', '\\');
  if (text.startsWith('\\\\?\\') || text.startsWith('\\\\.\\') || text.startsWith('\\??\\')) return fail('device_namespace');
  if (text.startsWith('\\\\')) return fail('unc');
  if (!/^[A-Za-z]:\\/.test(text)) return fail('not_absolute');
  const parts: string[] = [];
  // Cada nome é conferido, até os que um `..` depois tira: nada estranho passa, nem de passagem.
  for (const name of text.slice(3).split('\\')) {
    if (name === '' || name === '.') continue;
    if (name === '..') {
      // Como o Windows: acima da raiz da unidade, fica na raiz.
      parts.pop();
      continue;
    }
    const problem = nameProblem(name);
    if (problem !== null) return fail(problem);
    parts.push(name);
  }
  return { ok: true, path: build(text.charAt(0).toUpperCase(), parts) };
}

/** Para caminhos de configuração, que vêm do próprio Jesus: inválido é erro de programação. */
export function windowsPath(text: string): WindowsPath {
  const parsed = parseWindowsPath(text);
  if (!parsed.ok) throw new Error(`caminho do Windows inválido (${parsed.problem})`);
  return parsed.path;
}

/** `child` é `parent` ou fica dentro dele (nome a nome, sem diferenciar maiúsculas: `C:\a` não contém `C:\ab`). */
export function isInside(child: WindowsPath, parent: WindowsPath): boolean {
  if (child.folded.length < parent.folded.length) return false;
  return parent.folded.every((name, index) => child.folded[index] === name);
}

/** `base` mais nomes (de configuração, conferidos como qualquer caminho). */
export function joinPath(base: WindowsPath, ...names: readonly string[]): WindowsPath {
  return windowsPath([base.text, ...names].join('\\'));
}
