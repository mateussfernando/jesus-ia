import { isJesusPath, sensitiveKind } from '@jesus/gate';
import { HIGH_CONFIDENCE_SECRETS, maskSecrets, wrapUntrusted } from '@jesus/shared';
import type { SecretKind } from '@jesus/shared';
import type { BigIntStats, Dir } from 'node:fs';
import type { FileListInput } from './catalog';
import { cancelled } from './context';
import type { ExecutorContext } from './context';
import { checkDirectory, childPath, fsProblem, kindOf, stillSame } from './open';
import type { ToolFailure, ToolResult } from './outcome';
import { displayName, formatCount, formatSize } from './text';

/**
 * `file_list`: um nível de uma pasta, em ordem de nome. As pastas do Jesus nem aparecem; o que é sensível aparece
 * marcado, sem ser olhado. Nomes passam só pelas regras de segredo de alta confiança (as outras estragariam nomes
 * comuns, e o nome mascarado não abre mais o arquivo).
 */

const fail = (failure: ToolFailure): ToolResult => ({ ok: false, failure });

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Como o Explorador do Windows: sem diferenciar maiúsculas, com números em ordem de valor (`2` antes de `10`). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Nome para o modelo: sem invisíveis e com as regras de segredo de alta confiança. */
export function maskName(name: string, secrets: SecretKind[]): string {
  const masked = maskSecrets(displayName(name), { kinds: HIGH_CONFIDENCE_SECRETS });
  secrets.push(...masked.findings);
  return masked.text;
}

function describeEntry(shown: string, stats: BigIntStats): string {
  if (stats.isSymbolicLink()) return `[link] ${shown}`;
  switch (kindOf(stats)) {
    case 'directory':
      return `[pasta] ${shown}`;
    case 'file':
      return stats.nlink === 1n
        ? `[arquivo] ${shown} (${formatSize(stats.size)})`
        : `[arquivo] ${shown} (${formatSize(stats.size)}; tem mais de um nome, e o Jesus não lê)`;
    case 'other':
      return `[outro] ${shown} (não é arquivo nem pasta comum)`;
  }
}

export async function listDirectory(input: FileListInput, context: ExecutorContext): Promise<ToolResult> {
  const directory = await checkDirectory(input.path, context);
  if (!directory.ok) return fail(directory.problem);
  const names: string[] = [];
  let more = false;
  let dir: Dir;
  try {
    dir = await context.fs.opendir(directory.real.text);
  } catch (error) {
    return fail({ reason: fsProblem(error) });
  }
  try {
    // O `for await` fecha a pasta no fim, no `break` e no erro.
    for await (const entry of dir) {
      if (names.length >= context.limits.listScan) {
        more = true;
        break;
      }
      names.push(entry.name);
    }
  } catch (error) {
    return fail({ reason: fsProblem(error) });
  }
  if (cancelled(context)) return fail({ reason: 'cancelled' });
  if (!(await stillSame(directory, context.fs))) return fail({ reason: 'changed' });

  names.sort(compareNames);
  const lines: string[] = [];
  const secrets: SecretKind[] = [];
  let total = 0;
  for (const name of names) {
    const child = childPath(directory.real, name);
    if (child !== null && isJesusPath(child, context.policy.places)) continue;
    total += 1;
    if (lines.length >= context.limits.listEntries) continue;
    const shown = maskName(name, secrets);
    if (child === null) {
      lines.push(`[não lido] ${shown} (nome que o Jesus não lê)`);
      continue;
    }
    if (sensitiveKind(child, context.policy.places) !== null) {
      lines.push(`[sensível] ${shown} (o Jesus não lê)`);
      continue;
    }
    try {
      lines.push(describeEntry(shown, await context.fs.lstat(child.text)));
    } catch {
      lines.push(`[não lido] ${shown} (não deu para ver o que é)`);
    }
  }

  if (total === 0) return { ok: true, text: 'A pasta está vazia.', secrets, stats: { tool: 'file_list', shown: 0, total: 0, more: false } };
  const notes = [more ? `A pasta tem mais de ${formatCount(context.limits.listScan)} itens.` : `Pasta com ${formatCount(total)} ${total === 1 ? 'item' : 'itens'}.`];
  if (lines.length < total || more) {
    notes.push(`Mostrando ${formatCount(lines.length)}, em ordem de nome; para achar algo específico, use file_search.`);
  }
  return {
    ok: true,
    text: `${notes.join(' ')}\n${wrapUntrusted({ source: 'file_list', content: lines.join('\n') })}`,
    secrets,
    stats: { tool: 'file_list', shown: lines.length, total, more },
  };
}
