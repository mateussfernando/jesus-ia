import { checkLinkTarget, checkRequestedPath, checkResolvedPath, parsePath } from '@jesus/gate';
import type { EntryKind, GatePath, PathPlatform, ReadDenial, ReadPolicy, ResolvedFacts } from '@jesus/gate';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import type { ExecutorContext } from './context';
import type { ExecutorFs } from './fs';
import type { FsProblem } from './outcome';

/**
 * Abrir um caminho com as duas conferências do Porteiro (decisão 0021), na ordem que a decisão pede:
 * 1. o caminho pedido, só pelo texto, antes de tocar o disco (um caminho de rede nem é aberto);
 * 2. o passeio nome a nome com `lstat`, sem deixar o sistema seguir link nenhum: cada link é lido (`readlink`) e o
 *    caminho a que ele leva é conferido pelo Porteiro antes de ser tocado. No Windows, abrir `\\servidor\pasta` (ou
 *    `\\servidor@SSL\…`, pelo WebDAV) já manda a credencial do usuário ao servidor; um link plantado numa pasta liberada
 *    (num repositório baixado, por exemplo) não pode fazer isso;
 * 3. o caminho real, o tipo e o número de nomes, de novo pelo Porteiro, antes de abrir (hardlink nem é aberto);
 * 4. abre, sem seguir link no último nome onde o sistema deixa, e confere que o arquivo aberto é o que foi conferido
 *    (`dev` e `ino` do `fstat`);
 * 5. o `realpath` nativo (junção, nome curto, unidade de rede ou `subst` que o texto não mostra) e o mesmo arquivo de
 *    novo (`dev` e `ino`), e o Porteiro com esse caminho, o tipo e o `nlink` do arquivo aberto.
 * Só depois disso o conteúdo é lido, do arquivo já aberto.
 *
 * Uma troca no disco entre os passos (um arquivo virando link) dá `changed`: tentar de novo.
 */

export type Problem = { readonly reason: 'denied'; readonly denial: ReadDenial } | { readonly reason: FsProblem };

export type Checked<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly problem: Problem };

const denied = (denial: ReadDenial): { ok: false; problem: Problem } => ({ ok: false, problem: { reason: 'denied', denial } });
const failed = (reason: FsProblem): { ok: false; problem: Problem } => ({ ok: false, problem: { reason } });

export function kindOf(stats: BigIntStats): EntryKind {
  if (stats.isFile()) return 'file';
  return stats.isDirectory() ? 'directory' : 'other';
}

/** O mesmo arquivo: mesmo volume e mesmo número de arquivo. */
export function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

export function facts(real: string, stats: BigIntStats): ResolvedFacts {
  return { real, kind: kindOf(stats), links: Number(stats.nlink) };
}

export function fsProblem(error: unknown): FsProblem {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return 'not_found';
    case 'EACCES':
    case 'EPERM':
      return 'no_access';
    // No Windows, o arquivo aberto por outro programa sem compartilhar a leitura.
    case 'EBUSY':
      return 'busy';
    case 'ELOOP':
      return 'loop';
    default:
      return 'io';
  }
}

export function separatorOf(platform: PathPlatform): string {
  return platform === 'win32' ? '\\' : '/';
}

function withSeparator(path: GatePath): string {
  const separator = separatorOf(path.platform);
  return path.text.endsWith(separator) ? path.text : `${path.text}${separator}`;
}

/** `base` mais um nome, conferido pelo texto; só vale o filho direto (`null` se o nome não passar). */
export function childPath(base: GatePath, name: string): GatePath | null {
  const parsed = parsePath(`${withSeparator(base)}${name}`, base.platform);
  if (!parsed.ok || parsed.path.parts.length !== base.parts.length + 1) return null;
  return parsed.path;
}

function rootOf(path: GatePath): GatePath {
  const parsed = parsePath(path.platform === 'win32' ? `${path.root}:\\` : '/', path.platform);
  if (!parsed.ok) throw new Error('raiz inválida');
  return parsed.path;
}

/**
 * Alvo de link relativo à pasta do link. No Windows, `\pasta` (relativo à raiz da unidade atual) e `C:pasta` contam
 * como absolutos, para o Porteiro recusar (ambíguos), em vez de serem juntados à pasta.
 */
function isRelativeTarget(target: string, platform: PathPlatform): boolean {
  if (platform === 'posix') return !target.startsWith('/');
  return !(target.startsWith('\\') || target.startsWith('/') || /^[A-Za-z]:/.test(target));
}

interface Walked {
  /** O caminho sem nenhum link, pelo texto. */
  readonly real: GatePath;
  /** O `lstat` do último nome (que não é link). */
  readonly stats: BigIntStats;
}

/** Passo 2: resolve os links nome a nome, conferindo cada alvo antes de tocá-lo. */
async function walk(requested: GatePath, policy: ReadPolicy, fs: ExecutorFs, linkHops: number): Promise<Checked<Walked>> {
  let base = rootOf(requested);
  let pending: string[] = [...requested.parts];
  let stats: BigIntStats | null = null;
  let hops = 0;
  for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
    const next = childPath(base, name);
    // Os nomes vêm de caminhos já conferidos pelo Porteiro: não passar aqui é erro de programação.
    if (next === null) throw new Error('nome inválido no passeio');
    let current: BigIntStats;
    try {
      current = await fs.lstat(next.text);
    } catch (error) {
      return failed(fsProblem(error));
    }
    if (current.isSymbolicLink()) {
      hops += 1;
      if (hops > linkHops) return failed('loop');
      let target: string;
      try {
        target = await fs.readlink(next.text);
      } catch (error) {
        return failed(fsProblem(error));
      }
      const separator = separatorOf(base.platform);
      const joined = isRelativeTarget(target, base.platform) ? `${withSeparator(base)}${target}` : target;
      const verdict = checkLinkTarget([joined, ...pending].join(separator), policy);
      if (verdict.decision === 'deny') return denied(verdict.denial);
      base = rootOf(verdict.path);
      pending = [...verdict.path.parts];
      stats = null;
      continue;
    }
    if (pending.length > 0 && !current.isDirectory()) return failed('not_found');
    base = next;
    stats = current;
  }
  if (stats === null) {
    try {
      stats = await fs.lstat(base.text);
    } catch (error) {
      return failed(fsProblem(error));
    }
  }
  return { ok: true, real: base, stats };
}

/** Passos 1 a 3. */
async function resolve(text: string, expected: 'file' | 'directory', context: ExecutorContext): Promise<Checked<{ requested: GatePath } & Walked>> {
  const requested = checkRequestedPath(text, context.policy);
  if (requested.decision === 'deny') return denied(requested.denial);
  const walked = await walk(requested.path, context.policy, context.fs, context.limits.linkHops);
  if (!walked.ok) return walked;
  const before = checkResolvedPath(requested.path, facts(walked.real.text, walked.stats), expected, context.policy);
  if (before.decision === 'deny') return denied(before.denial);
  return { ok: true, requested: requested.path, real: walked.real, stats: walked.stats };
}

/** Passo 5: o caminho real pelo sistema, que tem de levar ao mesmo arquivo. */
async function nativeReal(path: GatePath, expected: BigIntStats, fs: ExecutorFs): Promise<Checked<{ text: string; stats: BigIntStats }>> {
  let text: string;
  let stats: BigIntStats;
  try {
    text = await fs.realpath(path.text);
    stats = await fs.stat(text);
  } catch (error) {
    const problem = fsProblem(error);
    return failed(problem === 'not_found' || problem === 'loop' ? 'changed' : problem);
  }
  return sameFile(stats, expected) ? { ok: true, text, stats } : failed('changed');
}

export interface OpenedFile {
  readonly handle: FileHandle;
  /** O `fstat` do arquivo aberto. */
  readonly stats: BigIntStats;
  readonly real: GatePath;
}

export async function openFile(text: string, context: ExecutorContext): Promise<Checked<OpenedFile>> {
  const resolved = await resolve(text, 'file', context);
  if (!resolved.ok) return resolved;
  let handle: FileHandle;
  try {
    handle = await context.fs.open(resolved.real.text);
  } catch (error) {
    const problem = fsProblem(error);
    // `ELOOP` aqui é o último nome que virou link depois do `lstat` (o `O_NOFOLLOW` recusou).
    return failed(problem === 'loop' || problem === 'not_found' ? 'changed' : problem);
  }
  const close = async (result: { ok: false; problem: Problem }) => {
    await handle.close();
    return result;
  };
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(opened, resolved.stats)) return await close(failed('changed'));
    const real = await nativeReal(resolved.real, opened, context.fs);
    if (!real.ok) return await close(real);
    const after = checkResolvedPath(resolved.requested, facts(real.text, opened), 'file', context.policy);
    if (after.decision === 'deny') return await close(denied(after.denial));
    return { ok: true, handle, stats: opened, real: after.real };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export interface CheckedDirectory {
  readonly real: GatePath;
  readonly stats: BigIntStats;
}

/**
 * Pasta: os mesmos passos, menos abrir (o Node não dá `fstat` de pasta aberta). Quem lista confere de novo, no fim, que
 * a pasta continua a mesma (`stillSame`).
 */
export async function checkDirectory(text: string, context: ExecutorContext): Promise<Checked<CheckedDirectory>> {
  const resolved = await resolve(text, 'directory', context);
  if (!resolved.ok) return resolved;
  const real = await nativeReal(resolved.real, resolved.stats, context.fs);
  if (!real.ok) return real;
  const after = checkResolvedPath(resolved.requested, facts(real.text, real.stats), 'directory', context.policy);
  if (after.decision === 'deny') return denied(after.denial);
  return { ok: true, real: after.real, stats: real.stats };
}

export async function stillSame(directory: CheckedDirectory, fs: ExecutorFs): Promise<boolean> {
  try {
    return sameFile(await fs.stat(directory.real.text), directory.stats);
  } catch {
    return false;
  }
}

/** Lê `length` bytes do começo do arquivo aberto (menos, se ele encolheu). */
export async function readStart(handle: FileHandle, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}
