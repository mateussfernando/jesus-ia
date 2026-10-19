import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { AnchorStore, AuditAnchor } from '@jesus/shared/audit';
import { z } from 'zod';
import type { Vault } from './vault';

/**
 * Âncora do registro de auditoria (decisão 0022): no cofre (decisão 0020), cifrada pelo DPAPI; num arquivo ao lado do
 * registro só onde o cofre não funciona (Linux sem chaveiro, nos testes) e como origem da migração. Num arquivo comum,
 * quem consegue mexer no registro também mexe na âncora; o que ela pega aí é o corte do fim e a troca do registro por
 * quem não sabe dela.
 */

const AnchorFileSchema = z.strictObject({
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export interface FileAnchorStore extends AnchorStore {
  remove(): Promise<void>;
}

function parseAnchor(raw: string): AuditAnchor | null {
  try {
    const parsed = AnchorFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function fileAnchorStore(path: string): FileAnchorStore {
  return {
    async read(): Promise<AuditAnchor | null> {
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      // Âncora estragada vale como ausente: o registro que existir vai para o lado e um novo começa.
      return parseAnchor(raw);
    },
    async write(anchor): Promise<void> {
      // Troca atômica: a âncora nunca fica pela metade.
      const temporary = `${path}.novo`;
      await writeFile(temporary, JSON.stringify(anchor), { mode: 0o600 });
      await rename(temporary, path);
    },
    remove: () => rm(path, { force: true }),
  };
}

/**
 * Âncora no cofre. Migração: enquanto o cofre não tem âncora, vale a do arquivo antigo (uma vez); a primeira gravação
 * vai para o cofre e apaga o arquivo.
 */
export function vaultAnchorStore(vault: Pick<Vault, 'get' | 'set'>, legacy: FileAnchorStore): AnchorStore {
  return {
    async read(): Promise<AuditAnchor | null> {
      const raw = vault.get('audit_anchor');
      return raw === null ? legacy.read() : parseAnchor(raw);
    },
    async write(anchor): Promise<void> {
      vault.set('audit_anchor', JSON.stringify(anchor));
      await legacy.remove();
    },
  };
}
