import { rm } from 'node:fs/promises';
import type { AnchorStore, AuditAnchor } from '@jesus/shared/audit';
import { z } from 'zod';
import { readFileIfExists, writeFileDurably } from './durable-file';
import { seal, unseal } from './vault';
import type { SafeStorageLike, Vault } from './vault';

/**
 * Âncora do registro de auditoria (decisão 0022). Fica num arquivo próprio, cifrado pelo `safeStorage` (no Windows,
 * DPAPI; decisão 0020), separado do cofre da chave: ela é regravada a cada linha do registro, e o arquivo da chave só
 * muda quando o dono mexe na chave. Num arquivo comum ao lado do registro, só onde o cofre não funciona (Linux sem
 * chaveiro, nos testes). Num arquivo comum, quem consegue mexer no registro também mexe na âncora; o que ela pega aí é
 * o corte do fim e a troca do registro por quem não sabe dela.
 *
 * Âncora que não se lê (arquivo estragado, cifra que não abre mais) faz a leitura lançar: o registro trata isso como
 * âncora ilegível, põe o arquivo de lado e recomeça (`AuditWriter.open`), sem nunca ficar sem registro.
 */

const AnchorSchema = z.strictObject({
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

const SealedAnchorFileSchema = z.strictObject({ v: z.literal(1), anchor: z.string().max(16_384) });

export interface FileAnchorStore extends AnchorStore {
  remove(): Promise<void>;
}

/** A âncora em JSON; lança se não for uma âncora válida. */
function parseAnchor(raw: string): AuditAnchor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('âncora estragada');
  }
  const result = AnchorSchema.safeParse(parsed);
  if (!result.success) throw new Error('âncora estragada');
  return result.data;
}

/** Âncora num arquivo comum (onde o cofre não funciona, e a origem da migração das etapas 6 e 7). */
export function fileAnchorStore(path: string, platform: NodeJS.Platform = process.platform): FileAnchorStore {
  return {
    async read(): Promise<AuditAnchor | null> {
      const raw = await readFileIfExists(path, platform);
      return raw === null ? null : parseAnchor(raw);
    },
    write: (anchor) => writeFileDurably(path, JSON.stringify(anchor), platform),
    remove: () => rm(path, { force: true }),
  };
}

export interface SealedAnchorStoreOptions {
  /** O arquivo da âncora cifrada (no app, `audit-anchor.vault` na pasta de dados). */
  readonly path: string;
  readonly storage: SafeStorageLike;
  readonly platform?: NodeJS.Platform;
  /** Onde a âncora ficava antes: no cofre da chave (etapa 8) e, antes dele, num arquivo comum (etapas 6 e 7). */
  readonly previous: { readonly vault: Pick<Vault, 'has' | 'get' | 'delete'>; readonly legacy: FileAnchorStore };
}

/**
 * Âncora cifrada no arquivo próprio. Migração: sem esse arquivo, vale a âncora que estava no cofre da chave e, sem ela,
 * a do arquivo comum; a primeira gravação vai para o arquivo próprio e apaga as antigas.
 */
export function sealedAnchorStore(options: SealedAnchorStoreOptions): AnchorStore {
  const platform = options.platform ?? process.platform;
  const { vault, legacy } = options.previous;
  let migrated = false;
  return {
    async read(): Promise<AuditAnchor | null> {
      const raw = await readFileIfExists(options.path, platform);
      if (raw !== null) {
        let file: z.infer<typeof SealedAnchorFileSchema>;
        try {
          file = SealedAnchorFileSchema.parse(JSON.parse(raw));
        } catch {
          throw new Error('arquivo da âncora estragado');
        }
        return parseAnchor(unseal(options.storage, platform, file.anchor));
      }
      const old = vault.get('audit_anchor');
      return old === null ? legacy.read() : parseAnchor(old);
    },
    async write(anchor): Promise<void> {
      const sealed = seal(options.storage, platform, JSON.stringify(anchor));
      await writeFileDurably(options.path, JSON.stringify({ v: 1, anchor: sealed }), platform);
      if (migrated) return;
      migrated = true;
      // As âncoras antigas saem uma vez; um cofre da chave estragado fica como está (só o dono o recomeça).
      try {
        if (vault.has('audit_anchor')) vault.delete('audit_anchor');
      } catch {
        // Fica para a próxima abertura: a âncora do arquivo próprio já vale.
      }
      await legacy.remove().catch(() => undefined);
    },
  };
}
