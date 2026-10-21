import { maskSecrets, wrapUntrusted } from '@jesus/shared';
import { MAX_READ_LINES } from './catalog';
import type { FileReadInput } from './catalog';
import { cancelled } from './context';
import type { ExecutorContext } from './context';
import { fsProblem, openFile, readStart } from './open';
import type { ToolFailure, ToolResult } from './outcome';
import { cutLine, decodeText, formatCount, formatSize, splitLines } from './text';

/**
 * `file_read`: as linhas numeradas de um arquivo de texto. O arquivo inteiro lido (até o corte) é mascarado de uma vez,
 * mantendo as quebras de linha: um pedaço do meio de uma chave PEM não escapa por ter ficado sem o cabeçalho, e a
 * numeração continua certa depois de uma chave de várias linhas.
 */

const fail = (failure: ToolFailure): ToolResult => ({ ok: false, failure });

export async function readFile(input: FileReadInput, context: ExecutorContext): Promise<ToolResult> {
  const opened = await openFile(input.path, context);
  if (!opened.ok) return fail(opened.problem);
  const size = opened.stats.size;
  const partial = size > BigInt(context.limits.readBytes);
  let bytes: Uint8Array;
  try {
    bytes = await readStart(opened.handle, Number(partial ? BigInt(context.limits.readBytes) : size));
  } catch (error) {
    return fail({ reason: fsProblem(error) });
  } finally {
    await opened.handle.close();
  }
  if (cancelled(context)) return fail({ reason: 'cancelled' });

  const decoded = decodeText(bytes, partial);
  if (!decoded.ok) return fail({ reason: 'binary' });
  const masked = maskSecrets(decoded.text, { keepLines: true });
  const lines = splitLines(masked.text);
  const total = lines.length;
  const first = input.offset ?? 1;
  if (total === 0) return { ok: true, text: 'O arquivo está vazio.', secrets: [], stats: { tool: 'file_read', firstLine: 0, lastLine: 0, totalLines: 0, partial } };
  if (first > total) return fail({ reason: 'offset', lines: total });

  const wanted = input.limit ?? MAX_READ_LINES;
  const out: string[] = [];
  let chars = 0;
  let last = first - 1;
  for (let number = first; number < first + wanted && number <= total; number++) {
    const line = `${number}\t${cutLine(lines[number - 1] ?? '', context.limits.lineChars)}`;
    // A primeira linha sempre vai (ela já foi cortada); as outras param no teto da resposta.
    if (out.length > 0 && chars + line.length + 1 > context.limits.readChars) break;
    out.push(line);
    chars += line.length + 1;
    last = number;
  }

  const notes = [
    partial
      ? `Linhas ${formatCount(first)} a ${formatCount(last)} das ${formatCount(total)} primeiras do arquivo.`
      : `Linhas ${formatCount(first)} a ${formatCount(last)} de ${formatCount(total)}.`,
  ];
  if (last < total) notes.push(`Para continuar, peça offset ${last + 1}.`);
  if (partial) notes.push(`O arquivo tem ${formatSize(size)}; só os primeiros ${formatSize(context.limits.readBytes)} podem ser lidos.`);
  return {
    ok: true,
    text: `${notes.join(' ')}\n${wrapUntrusted({ source: 'file_read', content: out.join('\n') })}`,
    secrets: masked.findings,
    stats: { tool: 'file_read', firstLine: first, lastLine: last, totalLines: total, partial },
  };
}
