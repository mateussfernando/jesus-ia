import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Cofre do Jesus no processo principal (seção 3.5; decisão 0020). Os valores são cifrados pelo `safeStorage` do
 * Electron (no Windows, DPAPI) e guardados num arquivo da pasta de dados; o texto aberto só existe na memória do
 * principal, na hora de usar. Nunca vai para o modelo, para o registro, para os logs nem para o ambiente dos filhos.
 *
 * O `safeStorage` síncrono basta: as operações são raras (salvar a chave, ler na hora de chamar a API).
 * No Linux (testes), o cofre recusa a "senha" embutida (`basic_text`) e o estado antes do `ready` (`unknown`), e só
 * aceita blobs `v11` (chave do chaveiro do sistema); o `v10` é cifrado com uma senha fixa, conhecida.
 * Limite (seção 3.5): o DPAPI protege contra outros usuários do PC, não contra programas rodando como você.
 */

/** O que o `safeStorage` do Electron oferece e o cofre usa (nos testes, um falso). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export const VAULT_ENTRIES = ['anthropic_api_key', 'audit_anchor'] as const;
export type VaultEntry = (typeof VAULT_ENTRIES)[number];

export type VaultProblem = 'unavailable' | 'insecure_backend';

export class VaultError extends Error {
  override readonly name = 'VaultError';
  constructor(readonly problem: VaultProblem | 'corrupt' | 'foreign_blob') {
    super(`cofre: ${problem}`);
  }
}

/** O cofre funciona aqui? No Linux, sem chaveiro do sistema, não: a cifra seria com uma senha conhecida. */
export function vaultProblem(storage: SafeStorageLike, platform: NodeJS.Platform): VaultProblem | null {
  if (!storage.isEncryptionAvailable()) return 'unavailable';
  if (platform === 'linux') {
    const backend = storage.getSelectedStorageBackend?.() ?? 'unknown';
    if (backend === 'basic_text' || backend === 'unknown') return 'insecure_backend';
  }
  return null;
}

const VaultFileSchema = z.strictObject({
  v: z.literal(1),
  entries: z.partialRecord(z.enum(VAULT_ENTRIES), z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(16_384)),
});
type VaultFile = z.infer<typeof VaultFileSchema>;

export class Vault {
  readonly #path: string;
  readonly #storage: SafeStorageLike;
  readonly #platform: NodeJS.Platform;

  constructor(path: string, storage: SafeStorageLike, platform: NodeJS.Platform = process.platform) {
    this.#path = path;
    this.#storage = storage;
    this.#platform = platform;
  }

  /** `null` se o cofre funciona; senão, o motivo. */
  problem(): VaultProblem | null {
    return vaultProblem(this.#storage, this.#platform);
  }

  #ensureUsable(): void {
    const problem = this.problem();
    if (problem !== null) throw new VaultError(problem);
  }

  #read(): VaultFile {
    let raw: string;
    try {
      raw = readFileSync(this.#path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1, entries: {} };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new VaultError('corrupt');
    }
    const result = VaultFileSchema.safeParse(parsed);
    if (!result.success) throw new VaultError('corrupt');
    return result.data;
  }

  #write(file: VaultFile): void {
    // Troca atômica: o cofre nunca fica pela metade.
    const temporary = `${this.#path}.novo`;
    writeFileSync(temporary, JSON.stringify(file), { mode: 0o600 });
    renameSync(temporary, this.#path);
  }

  /** No Linux, só o blob cifrado com a chave do chaveiro do sistema (`v11`) vale. */
  #checkBlob(blob: Buffer): void {
    if (this.#platform === 'linux' && blob.subarray(0, 3).toString('latin1') !== 'v11') throw new VaultError('foreign_blob');
  }

  has(entry: VaultEntry): boolean {
    return this.#read().entries[entry] !== undefined;
  }

  get(entry: VaultEntry): string | null {
    this.#ensureUsable();
    const encoded = this.#read().entries[entry];
    if (encoded === undefined) return null;
    const blob = Buffer.from(encoded, 'base64');
    this.#checkBlob(blob);
    return this.#storage.decryptString(blob);
  }

  set(entry: VaultEntry, value: string): void {
    this.#ensureUsable();
    const blob = this.#storage.encryptString(value);
    this.#checkBlob(blob);
    const file = this.#read();
    this.#write({ v: 1, entries: { ...file.entries, [entry]: blob.toString('base64') } });
  }

  delete(entry: VaultEntry): void {
    const file = this.#read();
    if (file.entries[entry] === undefined) return;
    const entries = Object.fromEntries(Object.entries(file.entries).filter(([name]) => name !== entry));
    this.#write({ v: 1, entries });
  }
}
