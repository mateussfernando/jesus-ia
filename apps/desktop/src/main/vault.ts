import { renameSync } from 'node:fs';
import { z } from 'zod';
import { readFileIfExistsSync, retryTransientSync, writeFileDurablySync } from './durable-file';

/**
 * Cofre do Jesus no processo principal (seção 3.5; decisão 0020). Os valores são cifrados pelo `safeStorage` do
 * Electron (no Windows, DPAPI) e guardados num arquivo da pasta de dados; o texto aberto só existe na memória do
 * principal, na hora de usar. Nunca vai para o modelo, para o registro, para os logs nem para o ambiente dos filhos.
 *
 * O `safeStorage` síncrono basta: as operações são raras (salvar a chave, ler na hora de chamar a API).
 * No Linux (testes), o cofre recusa a "senha" embutida (`basic_text`) e o estado antes do `ready` (`unknown`), e só
 * aceita blobs `v11` (chave do chaveiro do sistema); o `v10` é cifrado com uma senha fixa, conhecida.
 * Limite (seção 3.5): o DPAPI protege contra outros usuários do PC, não contra programas rodando como você.
 *
 * O arquivo é gravado de forma atômica e durável (`durable-file.ts`). Arquivo estragado (queda no meio de uma gravação
 * antiga, versão desconhecida) não trava o cofre para sempre: a leitura dá erro, sem adivinhar, e a próxima gravação
 * pedida pelo dono (guardar ou apagar a chave) põe o arquivo de lado como prova e recomeça o cofre. Entradas de uma
 * versão mais nova do Jesus são guardadas como vieram.
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

/** Um valor cifrado, em base64. */
const SEALED = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(16_384);

const VaultFileSchema = z.strictObject({
  v: z.literal(1),
  // Entradas conhecidas e as de uma versão mais nova (guardadas como vieram).
  entries: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), SEALED)
    .refine((entries) => Object.keys(entries).length <= 32, 'entradas demais'),
});
type VaultFile = z.infer<typeof VaultFileSchema>;

/** No Linux, só o blob cifrado com a chave do chaveiro do sistema (`v11`) vale. */
function checkBlob(blob: Buffer, platform: NodeJS.Platform): void {
  if (platform === 'linux' && blob.subarray(0, 3).toString('latin1') !== 'v11') throw new VaultError('foreign_blob');
}

/** Cifra um texto pelo `safeStorage`, em base64 (o cofre precisa estar disponível; veja `vaultProblem`). */
export function seal(storage: SafeStorageLike, platform: NodeJS.Platform, plainText: string): string {
  const problem = vaultProblem(storage, platform);
  if (problem !== null) throw new VaultError(problem);
  const blob = storage.encryptString(plainText);
  checkBlob(blob, platform);
  return blob.toString('base64');
}

/** Abre um valor de `seal`. Lança se o cofre não está disponível ou se o valor não abre. */
export function unseal(storage: SafeStorageLike, platform: NodeJS.Platform, sealed: string): string {
  const problem = vaultProblem(storage, platform);
  if (problem !== null) throw new VaultError(problem);
  if (!SEALED.safeParse(sealed).success) throw new VaultError('corrupt');
  const blob = Buffer.from(sealed, 'base64');
  checkBlob(blob, platform);
  return storage.decryptString(blob);
}

export interface VaultOptions {
  readonly platform?: NodeJS.Platform;
  /** O arquivo estava estragado e foi posto de lado (nome do arquivo de prova) numa gravação pedida pelo dono. */
  readonly onReset?: (quarantined: string) => void;
  readonly now?: () => number;
}

export class Vault {
  readonly #path: string;
  readonly #storage: SafeStorageLike;
  readonly #platform: NodeJS.Platform;
  readonly #onReset: ((quarantined: string) => void) | undefined;
  readonly #now: () => number;

  constructor(path: string, storage: SafeStorageLike, options: VaultOptions = {}) {
    this.#path = path;
    this.#storage = storage;
    this.#platform = options.platform ?? process.platform;
    this.#onReset = options.onReset;
    this.#now = options.now ?? Date.now;
  }

  /** `null` se o cofre funciona; senão, o motivo. */
  problem(): VaultProblem | null {
    return vaultProblem(this.#storage, this.#platform);
  }

  #read(): VaultFile {
    const raw = readFileIfExistsSync(this.#path, this.#platform);
    if (raw === null) return { v: 1, entries: {} };
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

  /**
   * O arquivo para uma gravação: estragado, ele vai para o lado (prova) e o cofre recomeça vazio. Só as gravações
   * pedidas pelo dono passam por aqui; a leitura nunca apaga nada.
   */
  #readForWrite(): VaultFile {
    try {
      return this.#read();
    } catch (error) {
      if (!(error instanceof VaultError) || error.problem !== 'corrupt') throw error;
    }
    const quarantined = `${this.#path}.estragado-${new Date(this.#now()).toISOString().replace(/[:.]/g, '-')}`;
    retryTransientSync(() => renameSync(this.#path, quarantined), this.#platform);
    this.#onReset?.(quarantined);
    return { v: 1, entries: {} };
  }

  #write(file: VaultFile): void {
    writeFileDurablySync(this.#path, JSON.stringify(file), this.#platform);
  }

  has(entry: VaultEntry): boolean {
    return this.#read().entries[entry] !== undefined;
  }

  get(entry: VaultEntry): string | null {
    const sealed = this.#read().entries[entry];
    if (sealed === undefined) {
      // Sem o cofre, nada se abre (nem a ausência é garantida para quem chama).
      const problem = this.problem();
      if (problem !== null) throw new VaultError(problem);
      return null;
    }
    return unseal(this.#storage, this.#platform, sealed);
  }

  set(entry: VaultEntry, value: string): void {
    const sealed = seal(this.#storage, this.#platform, value);
    const file = this.#readForWrite();
    this.#write({ v: 1, entries: { ...file.entries, [entry]: sealed } });
  }

  delete(entry: VaultEntry): void {
    const file = this.#readForWrite();
    if (file.entries[entry] === undefined) return;
    const entries = Object.fromEntries(Object.entries(file.entries).filter(([name]) => name !== entry));
    this.#write({ v: 1, entries });
  }
}
