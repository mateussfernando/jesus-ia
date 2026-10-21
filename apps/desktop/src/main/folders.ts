import { randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import { checkReleaseFolder, isInside, parsePath } from '@jesus/gate';
import type { GatePath, ReadPolicy, ReleaseRefusal } from '@jesus/gate';
import type { AuditEvent } from '@jesus/shared/audit';
import { z } from 'zod';
import { MAX_RELEASED_FOLDERS } from '../bridge/executor-protocol';
import { readFileIfExists, retryTransientSync, writeFileDurably } from './durable-file';

/**
 * As pastas que o dono liberou para o Jesus ler (decisão 0026), no principal. A lista fica num arquivo próprio da pasta
 * de dados (`folders.json`, gravação atômica e durável); a liberação e a remoção vão também para o registro de
 * auditoria, que é a história (lá, o caminho passa pela máscara de segredos e pode sair diferente).
 *
 * - **Ao abrir, cada pasta passa de novo pelo Porteiro** (`checkReleaseFolder`, com os lugares de agora). A recusada
 *   sai da lista, com registro: nem um arquivo mexido à mão libera o que o Porteiro não deixa.
 * - **Sem registro de auditoria saudável, nenhuma pasta.** Se o registro foi posto de lado (adulterado, cortado, sem
 *   âncora) ou não abriu, a lista é esvaziada: liberar de novo é um gesto do dono (falha fechada).
 * - Arquivo estragado vai para o lado (`folders.json.estragado-<data>`) e a lista começa vazia.
 */

export interface ReleasedFolder {
  readonly id: string;
  /** O caminho real da pasta, como o Porteiro escreve (`C:\Users\…`). */
  readonly path: string;
  readonly releasedAt: number;
}

const FolderSchema = z.strictObject({ id: z.uuid(), path: z.string().min(1).max(4_096), releasedAt: z.number().int().nonnegative() });
const FileSchema = z.strictObject({ v: z.literal(1), folders: z.array(FolderSchema).max(MAX_RELEASED_FOLDERS) });

export type ReleaseCheck =
  | { readonly ok: true; readonly path: GatePath }
  | { readonly ok: false; readonly reason: 'refused'; readonly refusal: ReleaseRefusal }
  | { readonly ok: false; readonly reason: 'duplicate' | 'full' | 'unavailable' };

export type AddResult = { readonly ok: true; readonly folder: ReleasedFolder } | Exclude<ReleaseCheck, { readonly ok: true }> | { readonly ok: false; readonly reason: 'io' };

export interface FolderStoreOptions {
  readonly path: string;
  /** Os lugares do sistema, sem pastas liberadas: as regras de liberar pasta. */
  readonly policy: ReadPolicy;
  readonly audit: (event: AuditEvent) => Promise<unknown>;
  /** O registro de auditoria abriu saudável (sem ir para o lado). */
  readonly auditHealthy: boolean;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly platform?: NodeJS.Platform;
  readonly log?: (message: string) => void;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

export class FolderStore {
  readonly #options: FolderStoreOptions;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #platform: NodeJS.Platform;
  #folders: ReleasedFolder[];
  readonly #available: boolean;
  #writing: Promise<unknown> = Promise.resolve();

  private constructor(options: FolderStoreOptions, folders: ReleasedFolder[], available: boolean) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newId = options.newId ?? randomUUID;
    this.#platform = options.platform ?? process.platform;
    this.#folders = folders;
    this.#available = available;
  }

  static async open(options: FolderStoreOptions): Promise<FolderStore> {
    const now = options.now ?? Date.now;
    const platform = options.platform ?? process.platform;
    const log = options.log ?? (() => undefined);
    const record = (event: AuditEvent) => options.audit(event).catch(() => log('registro das pastas liberadas falhou'));

    let stored: z.infer<typeof FileSchema>['folders'] = [];
    let text: string | null = null;
    try {
      text = await readFileIfExists(options.path, platform);
    } catch {
      log('arquivo das pastas liberadas não se lê');
    }
    if (text !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const result = FileSchema.safeParse(parsed);
      if (result.success) {
        stored = result.data.folders;
      } else {
        const aside = `${options.path}.estragado-${stamp(now())}`;
        try {
          retryTransientSync(() => renameSync(options.path, aside), platform);
        } catch {
          log('arquivo estragado das pastas liberadas não foi para o lado');
        }
        await record({ type: 'folders.reset', reason: 'corrupt' });
      }
    }

    if (!options.auditHealthy) {
      const store = new FolderStore(options, [], false);
      if (stored.length > 0) {
        await store.#persist().catch(() => log('lista de pastas liberadas não foi esvaziada no disco'));
        await record({ type: 'folders.cleared', reason: 'audit_unhealthy', count: stored.length });
      }
      return store;
    }

    // Cada pasta passa de novo pelo Porteiro, com os lugares de agora; repetida conta uma vez.
    const kept: ReleasedFolder[] = [];
    for (const folder of stored) {
      const check = checkReleaseFolder(folder.path, options.policy);
      if (!check.ok) {
        await record({ type: 'folder.dropped', id: folder.id, reason: check.refusal.reason });
        continue;
      }
      if (kept.some((other) => other.id === folder.id || other.path === check.path.text)) continue;
      kept.push({ ...folder, path: check.path.text });
    }
    const store = new FolderStore(options, kept, true);
    if (kept.length !== stored.length) await store.#persist().catch(() => log('lista de pastas liberadas não foi regravada'));
    return store;
  }

  /** Dá para liberar pastas agora (registro de auditoria saudável). */
  get available(): boolean {
    return this.#available;
  }

  list(): readonly ReleasedFolder[] {
    return this.#folders.map((folder) => ({ ...folder }));
  }

  /** Os caminhos liberados, para a política das ferramentas. */
  releasedPaths(): string[] {
    return this.#folders.map((folder) => folder.path);
  }

  /** O que o Porteiro e a lista dizem de uma pasta escolhida (o caminho real), antes da confirmação do dono. */
  check(real: string): ReleaseCheck {
    if (!this.#available) return { ok: false, reason: 'unavailable' };
    const check = checkReleaseFolder(real, this.#options.policy);
    if (!check.ok) return { ok: false, reason: 'refused', refusal: check.refusal };
    // Já liberada, ou dentro de uma liberada.
    const covered = this.#folders.some((folder) => {
      const parsed = parsePath(folder.path, check.path.platform);
      return parsed.ok && isInside(check.path, parsed.path);
    });
    if (covered) return { ok: false, reason: 'duplicate' };
    if (this.#folders.length >= MAX_RELEASED_FOLDERS) return { ok: false, reason: 'full' };
    return { ok: true, path: check.path };
  }

  /** Libera a pasta (depois da confirmação do dono): primeiro o registro, depois a lista. */
  async add(real: string): Promise<AddResult> {
    const check = this.check(real);
    if (!check.ok) return check;
    const folder: ReleasedFolder = { id: this.#newId(), path: check.path.text, releasedAt: this.#now() };
    try {
      await this.#options.audit({ type: 'folder.released', id: folder.id, path: folder.path });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    this.#folders = [...this.#folders, folder];
    try {
      await this.#persist();
    } catch {
      this.#folders = this.#folders.filter((other) => other.id !== folder.id);
      await this.#options.audit({ type: 'folder.release_failed', id: folder.id }).catch(() => undefined);
      return { ok: false, reason: 'io' };
    }
    return { ok: true, folder };
  }

  /** Remove a pasta: primeiro sai da lista (a leitura para na hora), depois o registro. */
  async remove(id: string): Promise<boolean> {
    const folder = this.#folders.find((other) => other.id === id);
    if (folder === undefined) return false;
    this.#folders = this.#folders.filter((other) => other.id !== id);
    await this.#persist().catch(() => this.#options.log?.('lista de pastas liberadas não foi regravada depois de remover'));
    await this.#options.audit({ type: 'folder.removed', id }).catch(() => this.#options.log?.('registro da remoção falhou'));
    return true;
  }

  #persist(): Promise<void> {
    const data = `${JSON.stringify({ v: 1, folders: this.#folders })}\n`;
    const write = this.#writing.then(() => writeFileDurably(this.#options.path, data, this.#platform));
    this.#writing = write.catch(() => undefined);
    return write;
  }
}
