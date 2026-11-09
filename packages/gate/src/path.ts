/**
 * Caminhos conferidos só pelo texto (decisão 0021; seção 3.4.2). Nada aqui toca o disco: quem lê arquivos (o Executor)
 * resolve o caminho real e entrega os fatos, e o Porteiro decide com o caminho pedido e com o real.
 *
 * O produto é para Windows. A regra é recusar o que é ambíguo, em vez de tentar adivinhar o que o Windows faria:
 * prefixos `\\?\` e `\\.\`, caminhos de rede, fluxos alternativos (`arquivo:fluxo`), nomes terminados em ponto ou
 * espaço (o Windows os corta), nomes de dispositivo (`CON`, `NUL.txt`) e nomes curtos 8.3 (`PROGRA~1`), que só o disco
 * sabe para onde apontam.
 *
 * Os caminhos POSIX existem só para os testes e o desenvolvimento no Linux (o CI e as sessões na nuvem): mesmas
 * recusas de texto escondido, só absoluto, sem `\`, e comparação diferenciando maiúsculas, como no Linux.
 */

export type PathPlatform = 'win32' | 'posix';

export type PathProblem =
  | 'empty'
  | 'too_long'
  /** Caractere de controle ou formatação invisível (direção do texto, largura zero): o nome na tela não seria o real. */
  | 'control_char'
  /** `< > " | ? *` (no Windows), `\` (no POSIX) ou metade solta de um par de surrogates. */
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

export interface GatePath {
  readonly platform: PathPlatform;
  /** Caminho absoluto normalizado: `C:\pasta\arquivo.txt` (unidade maiúscula, `\`, sem `.` nem `..`) ou `/pasta/arquivo`. */
  readonly text: string;
  /** A raiz: a unidade maiúscula (`C`) no Windows, `/` no POSIX. */
  readonly root: string;
  /** Os nomes depois da raiz, como vieram. */
  readonly parts: readonly string[];
  /** A raiz e os nomes como o sistema compara: com a caixa dobrada no Windows, como vieram no POSIX. */
  readonly folded: readonly string[];
  /** A raiz e os nomes sempre com a caixa dobrada: para as regras de nomes sensíveis, que valem em qualquer caixa. */
  readonly upper: readonly string[];
}

export type ParsedPath = { readonly ok: true; readonly path: GatePath } | { readonly ok: false; readonly problem: PathProblem };

/** Maior caminho aceito (caracteres). O Windows chega a 32 mil, mas um caminho desse tamanho não é de uso normal. */
export const MAX_PATH_CHARS = 4_096;
/** Maior nome (o NTFS e o ext4 aceitam até 255). */
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

function windowsNameProblem(name: string): PathProblem | null {
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

function build(platform: PathPlatform, root: string, parts: readonly string[]): GatePath {
  const upper = Object.freeze([root, ...parts.map(foldCase)]);
  return {
    platform,
    text: platform === 'win32' ? `${root}:\\${parts.join('\\')}` : `/${parts.join('/')}`,
    root,
    parts: Object.freeze([...parts]),
    folded: platform === 'win32' ? upper : Object.freeze([root, ...parts]),
    upper,
  };
}

function hiddenProblem(input: string): PathProblem | null {
  if (input.length === 0) return 'empty';
  if (input.length > MAX_PATH_CHARS) return 'too_long';
  if (hasControl(input) || HIDDEN_FORMAT.test(input)) return 'control_char';
  if (LONE_SURROGATE.test(input)) return 'invalid_char';
  return null;
}

/** Junta os nomes, resolvendo `.` e `..` pelo texto (`..` acima da raiz fica na raiz) e conferindo cada nome. */
function collect(names: readonly string[], check: (name: string) => PathProblem | null): readonly string[] | PathProblem {
  const parts: string[] = [];
  // Cada nome é conferido, até os que um `..` depois tira: nada estranho passa, nem de passagem.
  for (const name of names) {
    if (name === '' || name === '.') continue;
    if (name === '..') {
      parts.pop();
      continue;
    }
    const problem = check(name);
    if (problem !== null) return problem;
    parts.push(name);
  }
  return parts;
}

export function parseWindowsPath(input: string): ParsedPath {
  const fail = (problem: PathProblem): ParsedPath => ({ ok: false, problem });
  const hidden = hiddenProblem(input);
  if (hidden !== null) return fail(hidden);
  const text = input.replaceAll('/', '\\');
  if (text.startsWith('\\\\?\\') || text.startsWith('\\\\.\\') || text.startsWith('\\??\\')) return fail('device_namespace');
  if (text.startsWith('\\\\')) return fail('unc');
  if (!/^[A-Za-z]:\\/.test(text)) return fail('not_absolute');
  const parts = collect(text.slice(3).split('\\'), windowsNameProblem);
  if (typeof parts === 'string') return fail(parts);
  return { ok: true, path: build('win32', text.charAt(0).toUpperCase(), parts) };
}

export function parsePosixPath(input: string): ParsedPath {
  const fail = (problem: PathProblem): ParsedPath => ({ ok: false, problem });
  const hidden = hiddenProblem(input);
  if (hidden !== null) return fail(hidden);
  if (!input.startsWith('/')) return fail('not_absolute');
  // Barra invertida num caminho do Linux é engano (um caminho do Windows) ou disfarce: recusa.
  if (input.includes('\\')) return fail('invalid_char');
  const parts = collect(input.split('/'), (name) => (name.length > MAX_NAME_CHARS ? 'too_long' : null));
  if (typeof parts === 'string') return fail(parts);
  return { ok: true, path: build('posix', '/', parts) };
}

export function parsePath(input: string, platform: PathPlatform): ParsedPath {
  return platform === 'win32' ? parseWindowsPath(input) : parsePosixPath(input);
}

/** A plataforma do sistema em que o código roda: Windows, ou POSIX nos testes e no desenvolvimento. */
export function hostPlatform(platform: NodeJS.Platform | string): PathPlatform {
  return platform === 'win32' ? 'win32' : 'posix';
}

/** Para caminhos de configuração, que vêm do próprio Jesus: inválido é erro de programação. */
export function hostPath(text: string, platform: PathPlatform): GatePath {
  const parsed = parsePath(text, platform);
  if (!parsed.ok) throw new Error(`caminho inválido (${parsed.problem})`);
  return parsed.path;
}

export function windowsPath(text: string): GatePath {
  return hostPath(text, 'win32');
}

/** `child` é `parent` ou fica dentro dele, nome a nome (`C:\a` não contém `C:\ab`), como o sistema compara. */
export function isInside(child: GatePath, parent: GatePath): boolean {
  if (child.platform !== parent.platform || child.folded.length < parent.folded.length) return false;
  return parent.folded.every((name, index) => child.folded[index] === name);
}

/** `base` mais nomes (de configuração, conferidos como qualquer caminho). */
export function joinPath(base: GatePath, ...names: readonly string[]): GatePath {
  const separator = base.platform === 'win32' ? '\\' : '/';
  return hostPath([base.text, ...names].join(separator), base.platform);
}

/** A pasta de cima (`null` na raiz). */
export function parentPath(path: GatePath): GatePath | null {
  return path.parts.length === 0 ? null : build(path.platform, path.root, path.parts.slice(0, -1));
}
