import { open, readFile, rename, truncate } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import { AnchorSchema, CHAIN_BROKEN, nextEntry, serializeEntry, toAuditEvent, verifyChain } from './chain';
import type { AuditAnchor, AuditEntry, AuditEvent, ChainVerdict } from './chain';

/**
 * Escritor do registro de auditoria (decisão 0022). Um só escritor (o processo principal); cada entrada é uma linha
 * gravada de uma vez e forçada ao disco (`fsync`) antes de a âncora avançar, então uma queda no meio deixa no máximo
 * uma linha incompleta no fim, que a próxima abertura corta (e registra).
 *
 * Ao abrir, o arquivo inteiro é conferido contra a âncora. Se a cadeia estiver quebrada, cortada ou sem âncora, o
 * arquivo é posto de lado como prova (`<nome>.adulterado-<data>`) e um registro novo começa com um evento
 * `audit.chain_broken`, ligado à última âncora boa. O app segue registrando; a tela do registro mostra o aviso.
 *
 * Âncora que não se lê (a leitura lança, ou o que veio não é uma âncora) vale como ausente, com a marca
 * `anchor: 'unreadable'` no evento: o registro nunca deixa de abrir por causa dela.
 */

export interface AnchorStore {
  read(): Promise<AuditAnchor | null>;
  write(anchor: AuditAnchor): Promise<void>;
}

export interface AuditWriterOptions {
  readonly path: string;
  readonly anchors: AnchorStore;
  readonly now?: () => number;
  /** Recebe cada entrada conferida do arquivo, na abertura (veja `verifyChain`). */
  readonly visit?: (entry: AuditEntry) => void;
}

export interface OpenedAuditWriter {
  readonly writer: AuditWriter;
  /** O que a conferência achou ao abrir (antes de qualquer reparo). */
  readonly verdict: ChainVerdict;
  /** Onde o arquivo quebrado foi posto de lado, se foi. */
  readonly quarantined: string | null;
  /** A âncora existia, mas não se leu (valeu como ausente). */
  readonly anchorUnreadable: boolean;
}

/** Lê a âncora; o que não se lê vale como ausente, com a marca. */
async function readAnchor(anchors: AnchorStore): Promise<{ readonly anchor: AuditAnchor | null; readonly unreadable: boolean }> {
  try {
    const stored = await anchors.read();
    if (stored === null) return { anchor: null, unreadable: false };
    const parsed = AnchorSchema.safeParse(stored);
    return parsed.success ? { anchor: parsed.data, unreadable: false } : { anchor: null, unreadable: true };
  } catch {
    return { anchor: null, unreadable: true };
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

export class AuditWriter {
  readonly #file: FileHandle;
  readonly #anchors: AnchorStore;
  readonly #now: () => number;
  #last: AuditAnchor | null;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;
  /** Uma gravação falhou: o estado do arquivo é incerto, e nada mais é gravado (quem chama decide o que fazer). */
  #failed = false;

  private constructor(file: FileHandle, anchors: AnchorStore, now: () => number, last: AuditAnchor | null) {
    this.#file = file;
    this.#anchors = anchors;
    this.#now = now;
    this.#last = last;
  }

  static async open(options: AuditWriterOptions): Promise<OpenedAuditWriter> {
    const now = options.now ?? Date.now;
    const content = await readIfExists(options.path);
    const { anchor, unreadable } = await readAnchor(options.anchors);
    const verdict = verifyChain(content ?? '', anchor, options.visit);
    const healthy = verdict.status === 'ok' || verdict.status === 'ahead';

    let quarantined: string | null = null;
    let last = verdict.last;
    if (healthy && verdict.tornTail) await truncate(options.path, verdict.validBytes);
    if (!healthy) {
      if (content !== null) {
        quarantined = `${options.path}.adulterado-${stamp(now())}`;
        await rename(options.path, quarantined);
      }
      // O registro novo continua da última âncora boa (ou do zero, sem âncora).
      last = anchor;
    }

    const file = await open(options.path, 'a', 0o600);
    const writer = new AuditWriter(file, options.anchors, now, last);
    if (!healthy) {
      await writer.append({
        type: CHAIN_BROKEN,
        reason: verdict.status,
        ...(unreadable ? { anchor: 'unreadable' } : {}),
        ...(verdict.problem === undefined ? {} : { line: verdict.problem.line, detail: verdict.problem.reason }),
        ...(quarantined === null ? {} : { quarantined: basename(quarantined) }),
      });
    } else if (verdict.tornTail || unreadable) {
      // Cada gravação leva a âncora junto: a estragada (com o registro vazio) é trocada aqui.
      if (verdict.tornTail) await writer.append({ type: 'audit.recovered', reason: 'torn_tail' });
      if (unreadable) await writer.append({ type: 'audit.recovered', reason: 'anchor_unreadable' });
    } else if (verdict.status === 'ahead' && last !== null) {
      await options.anchors.write(last);
    }
    return { writer, verdict, quarantined, anchorUnreadable: unreadable };
  }

  /** Acrescenta um evento; as chamadas entram em fila e saem na ordem. */
  append(event: AuditEvent): Promise<AuditEntry> {
    const run = this.#queue.then(() => this.#write(event));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  get last(): AuditAnchor | null {
    return this.#last;
  }

  async #write(event: AuditEvent): Promise<AuditEntry> {
    if (this.#closed) throw new Error('registro de auditoria fechado');
    if (this.#failed) throw new Error('registro de auditoria indisponível depois de uma falha de gravação');
    const entry = nextEntry(this.#last, toAuditEvent(event), this.#now());
    const line = `${serializeEntry(entry)}\n`;
    try {
      await this.#file.appendFile(line, 'utf8');
      await this.#file.sync();
      this.#last = { seq: entry.seq, hash: entry.hash };
      await this.#anchors.write(this.#last);
    } catch (error) {
      this.#failed = true;
      throw error;
    }
    return entry;
  }

  async close(): Promise<void> {
    await this.#queue;
    if (this.#closed) return;
    this.#closed = true;
    await this.#file.close();
  }
}
