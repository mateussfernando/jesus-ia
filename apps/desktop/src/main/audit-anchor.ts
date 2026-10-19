import { readFile, rename, writeFile } from 'node:fs/promises';
import type { AnchorStore, AuditAnchor } from '@jesus/shared/audit';
import { z } from 'zod';

/**
 * Âncora do registro de auditoria num arquivo ao lado do registro (decisão 0022). **Provisória:** na etapa 8 ela passa
 * para o cofre (DPAPI). Num arquivo comum, quem consegue mexer no registro também mexe na âncora; o que ela já pega
 * aqui é o corte do fim e a troca do registro por quem não sabe dela.
 */

const AnchorFileSchema = z.strictObject({
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export function fileAnchorStore(path: string): AnchorStore {
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
      try {
        const parsed = AnchorFileSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async write(anchor): Promise<void> {
      // Troca atômica: a âncora nunca fica pela metade.
      const temporary = `${path}.novo`;
      await writeFile(temporary, JSON.stringify(anchor), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}
