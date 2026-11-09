import { checkResolvedPath, isJesusPath, sensitiveKind } from '@jesus/gate';
import type { GatePath } from '@jesus/gate';
import { maskSecrets, wrapUntrusted } from '@jesus/shared';
import type { SecretKind } from '@jesus/shared';
import type { BigIntStats, Dir } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import type { FileSearchInput } from './catalog';
import { cancelled } from './context';
import type { ExecutorContext } from './context';
import { SEARCH_SKIPPED_DIRS } from './limits';
import { compareNames, maskName } from './list-dir';
import { checkDirectory, childPath, facts, readStart, sameFile, separatorOf, stillSame } from './open';
import type { SearchStop, ToolFailure, ToolResult } from './outcome';
import { decodeText, fold, formatCount, formatSize, safeSlice, splitLines } from './text';

/**
 * `file_search`: texto literal, sem diferenciar maiúsculas, nos arquivos de texto de uma pasta e das subpastas, e nos
 * nomes. Com cortes em tudo (níveis, itens, arquivos, bytes, resultados e tempo), e sem seguir links: uma árvore com
 * laço ou com milhões de arquivos não prende o Executor.
 *
 * A pasta de partida passa pelas conferências completas do Porteiro. Daí para baixo, os caminhos vêm da própria
 * listagem das pastas (não do modelo) e só se desce em pasta de verdade do mesmo disco (o `lstat` diz que não é link, e
 * o `dev` é o da partida): cada arquivo é conferido pelo Porteiro (pasta do Jesus, sensível, hardlink) e aberto
 * conferindo `dev` e `ino`, sem o `realpath` de cada um, que dobraria o custo sem achar nada a mais.
 *
 * A busca compara com o texto **já mascarado**: procurar um pedaço de uma senha não acha a linha dela. Sem isso, a
 * presença de um resultado contaria ao modelo se o segredo contém o texto procurado, e bastariam algumas buscas para
 * descobri-lo letra por letra.
 */

const fail = (failure: ToolFailure): ToolResult => ({ ok: false, failure });

/** Uma pasta em visita: a busca desce em profundidade, na ordem de nome (como o `grep -r`). */
interface Frame {
  readonly path: GatePath;
  /** O caminho desde a pasta de partida, como o modelo vê (nomes mascarados); vazio na partida. */
  readonly shown: string;
  readonly depth: number;
  /** Os nomes da pasta, em ordem; `null` até ser lida. */
  names: string[] | null;
  next: number;
  /** A leitura dos nomes parou no corte de itens. */
  cut: boolean;
}

type Skip = 'binary' | 'large' | 'sensitive' | 'links' | 'mounts' | 'deep' | 'dependencies' | 'denied' | 'unreadable';

const SKIP_TEXT: Readonly<Record<Skip, (count: number) => string>> = {
  binary: (count) => `${formatCount(count)} ${count === 1 ? 'binário' : 'binários'}`,
  large: (count) => `${formatCount(count)} grande${count === 1 ? '' : 's'} demais`,
  sensitive: (count) => `${formatCount(count)} ${count === 1 ? 'sensível' : 'sensíveis'}`,
  links: (count) => `${formatCount(count)} ${count === 1 ? 'link' : 'links'}`,
  mounts: (count) => `${formatCount(count)} ${count === 1 ? 'pasta' : 'pastas'} de outro disco`,
  deep: (count) => `${formatCount(count)} ${count === 1 ? 'pasta funda' : 'pastas fundas'} demais`,
  dependencies: (count) => `${formatCount(count)} ${count === 1 ? 'pasta' : 'pastas'} de repositório ou dependências (.git, node_modules)`,
  denied: (count) => `${formatCount(count)} que o Porteiro não deixa ler`,
  unreadable: (count) => `${formatCount(count)} que não ${count === 1 ? 'deu' : 'deram'} para ler`,
};

type ChildRead = { readonly ok: true; readonly bytes: Uint8Array; readonly partial: boolean } | { readonly ok: false; readonly skip: Skip };

async function readChild(child: GatePath, stats: BigIntStats, context: ExecutorContext): Promise<ChildRead> {
  const before = checkResolvedPath(child, facts(child.text, stats), 'file', context.policy);
  if (before.decision === 'deny') return { ok: false, skip: 'denied' };
  let handle: FileHandle;
  try {
    handle = await context.fs.open(child.text);
  } catch {
    return { ok: false, skip: 'unreadable' };
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(opened, stats)) return { ok: false, skip: 'unreadable' };
    const after = checkResolvedPath(child, facts(child.text, opened), 'file', context.policy);
    if (after.decision === 'deny') return { ok: false, skip: 'denied' };
    const max = BigInt(context.limits.searchFileBytes);
    const partial = opened.size > max;
    return { ok: true, bytes: await readStart(handle, Number(partial ? max : opened.size)), partial };
  } catch {
    return { ok: false, skip: 'unreadable' };
  } finally {
    await handle.close();
  }
}

/** O trecho da linha em volta do texto achado. */
function snippet(line: string, at: number, length: number, max: number): string {
  if (line.length <= max) return line.trim();
  const room = Math.max(0, max - length);
  const start = Math.max(0, Math.min(at - Math.floor(room / 2), line.length - max));
  const end = Math.min(line.length, start + max);
  return `${start > 0 ? '…' : ''}${safeSlice(line, start, end).trim()}${end < line.length ? '…' : ''}`;
}

function stopText(stopped: SearchStop, context: ExecutorContext, results: number): string {
  const { limits } = context;
  const advice = 'procure um texto mais específico ou numa subpasta.';
  switch (stopped) {
    case 'results':
      return `A busca parou em ${formatCount(results)} ${results === 1 ? 'resultado' : 'resultados'}; ${advice}`;
    case 'files':
      return `A busca parou depois de ${formatCount(limits.searchFiles)} arquivos; ${advice}`;
    case 'bytes':
      return `A busca parou depois de ler ${formatSize(limits.searchTotalBytes)}; ${advice}`;
    case 'entries':
      return `A busca parou depois de ${formatCount(limits.searchEntries)} itens de pasta; ${advice}`;
    case 'time':
      return `A busca parou no limite de ${formatCount(Math.round(limits.searchMillis / 1000))} segundos; ${advice}`;
  }
}

export async function searchFiles(input: FileSearchInput, context: ExecutorContext): Promise<ToolResult> {
  const root = await checkDirectory(input.path, context);
  if (!root.ok) return fail(root.problem);
  const { limits, policy } = context;
  const query = fold(input.query);
  const started = context.now();
  const separator = separatorOf(root.real.platform);
  const results: string[] = [];
  const secrets: SecretKind[] = [];
  const skipped: Record<Skip, number> = { binary: 0, large: 0, sensitive: 0, links: 0, mounts: 0, deep: 0, dependencies: 0, denied: 0, unreadable: 0 };
  let files = 0;
  let bytes = 0;
  let entries = 0;
  let stopped: SearchStop | null = null;
  let chars = 0;
  let overflow = false;
  const full = () => overflow || results.length >= limits.searchResults;
  const add = (line: string) => {
    // O primeiro resultado sempre vai; os outros param no teto da resposta (caminhos longos não lotam a conversa).
    if (results.length > 0 && chars + line.length + 1 > limits.responseChars) {
      overflow = true;
      return;
    }
    results.push(line);
    chars += line.length + 1;
  };
  const stack: Frame[] = [{ path: root.real, shown: '', depth: 0, names: null, next: 0, cut: false }];

  while (stopped === null && !full()) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    if (cancelled(context)) return fail({ reason: 'cancelled' });
    if (frame.names === null) {
      if (entries >= limits.searchEntries) {
        stopped = 'entries';
        break;
      }
      const names: string[] = [];
      try {
        const dir: Dir = await context.fs.opendir(frame.path.text);
        for await (const entry of dir) {
          if (entries >= limits.searchEntries) {
            frame.cut = true;
            break;
          }
          entries += 1;
          names.push(entry.name);
        }
      } catch {
        skipped.unreadable += 1;
        stack.pop();
        continue;
      }
      frame.names = names.sort(compareNames);
      continue;
    }
    const name = frame.names[frame.next];
    if (name === undefined) {
      if (frame.cut) stopped = 'entries';
      stack.pop();
      continue;
    }
    frame.next += 1;
    if (context.now() - started > limits.searchMillis) {
      stopped = 'time';
      break;
    }
    const child = childPath(frame.path, name);
    if (child === null) {
      skipped.unreadable += 1;
      continue;
    }
    if (isJesusPath(child, policy.places)) continue;
    if (sensitiveKind(child, policy.places) !== null) {
      skipped.sensitive += 1;
      continue;
    }
    let stats: BigIntStats;
    try {
      stats = await context.fs.lstat(child.text);
    } catch {
      skipped.unreadable += 1;
      continue;
    }
    const maskedName = maskName(name, secrets);
    const shown = frame.shown === '' ? maskedName : `${frame.shown}${separator}${maskedName}`;
    // O nome também é comparado já mascarado.
    if (fold(maskedName).includes(query)) add(`[nome] ${shown}${stats.isDirectory() ? separator : ''}`);
    if (stats.isSymbolicLink()) {
      skipped.links += 1;
      continue;
    }
    if (stats.isDirectory()) {
      if (SEARCH_SKIPPED_DIRS.has(name)) skipped.dependencies += 1;
      // Ponto de montagem de outro disco: sem o `realpath` de cada arquivo, a busca não atravessa (como o `find -xdev`).
      else if (stats.dev !== root.stats.dev) skipped.mounts += 1;
      else if (frame.depth + 1 > limits.searchDepth) skipped.deep += 1;
      else stack.push({ path: child, shown, depth: frame.depth + 1, names: null, next: 0, cut: false });
      continue;
    }
    if (!stats.isFile()) {
      skipped.unreadable += 1;
      continue;
    }
    if (files >= limits.searchFiles) {
      stopped = 'files';
      break;
    }
    files += 1;
    if (stats.size > BigInt(limits.searchFileBytes)) {
      skipped.large += 1;
      continue;
    }
    if (bytes + Number(stats.size) > limits.searchTotalBytes) {
      stopped = 'bytes';
      break;
    }
    const content = await readChild(child, stats, context);
    if (!content.ok) {
      skipped[content.skip] += 1;
      continue;
    }
    bytes += content.bytes.length;
    const decoded = decodeText(content.bytes, content.partial);
    if (!decoded.ok) {
      skipped.binary += 1;
      continue;
    }
    // Só mascara (o que custa) o arquivo que tem o texto antes da máscara.
    if (!fold(decoded.text).includes(query)) continue;
    const masked = maskSecrets(decoded.text, { keepLines: true });
    secrets.push(...masked.findings);
    const lines = splitLines(masked.text);
    for (let index = 0; index < lines.length && !full(); index++) {
      const line = lines[index] ?? '';
      const at = fold(line).indexOf(query);
      if (at !== -1) add(`${shown}:${index + 1}: ${snippet(line, at, query.length, limits.snippetChars)}`);
    }
  }
  if (!(await stillSame(root, context.fs))) return fail({ reason: 'changed' });
  if (stopped === null && full()) stopped = 'results';

  const notes = [
    results.length === 0
      ? `Nenhum resultado (${formatCount(files)} ${files === 1 ? 'arquivo examinado' : 'arquivos examinados'}).`
      : `${formatCount(results.length)} ${results.length === 1 ? 'resultado' : 'resultados'} (${formatCount(files)} ${files === 1 ? 'arquivo examinado' : 'arquivos examinados'}).`,
  ];
  const skips = (Object.keys(skipped) as Skip[]).filter((skip) => skipped[skip] > 0).map((skip) => SKIP_TEXT[skip](skipped[skip]));
  if (skips.length > 0) notes.push(`Pulados: ${skips.join(', ')}.`);
  if (stopped !== null) notes.push(stopText(stopped, context, results.length));
  return {
    ok: true,
    text: results.length === 0 ? notes.join(' ') : `${notes.join(' ')}\n${wrapUntrusted({ source: 'file_search', content: results.join('\n') })}`,
    secrets,
    stats: { tool: 'file_search', results: results.length, files, stopped },
  };
}
