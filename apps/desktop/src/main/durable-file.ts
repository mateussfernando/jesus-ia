import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Gravação durável dos arquivos pequenos do principal (o cofre e a âncora do registro): o conteúdo vai para um arquivo
 * temporário, forçado ao disco (`fsync`) antes da troca de nome. Assim, uma queda de energia deixa o arquivo antigo ou
 * o novo, nunca um arquivo do tamanho certo cheio de zeros (o NTFS sem `fsync` pode deixar isso).
 *
 * No Windows, um antivírus ou o indexador que esteja lendo o arquivo faz a troca de nome (e às vezes a leitura) falhar
 * de passagem com `EPERM`, `EACCES` ou `EBUSY`: a operação é repetida algumas vezes, com espera curta e limitada.
 */

/** Esperas entre as tentativas (pouco mais de 1 s ao todo). */
export const RETRY_DELAYS_MS: readonly number[] = [10, 20, 50, 100, 200, 300, 400];
const TRANSIENT_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Falha que no Windows costuma ser de passagem (outro programa com o arquivo aberto). */
export function isTransientFsError(error: unknown, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && TRANSIENT_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '');
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Repete `operation` enquanto a falha for de passagem, com as esperas de `RETRY_DELAYS_MS` (bloqueia a thread). */
export function retryTransientSync<T>(operation: () => T, platform: NodeJS.Platform, sleep: (ms: number) => void = sleepSync): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientFsError(error, platform)) throw error;
      sleep(delay);
    }
  }
}

/** Como `retryTransientSync`, sem bloquear: espera com `setTimeout`. */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  platform: NodeJS.Platform,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientFsError(error, platform)) throw error;
      await sleep(delay);
    }
  }
}

/** Fora do Windows, força ao disco também a troca de nome (a entrada da pasta). Falha aqui não desfaz a gravação. */
function syncDirectorySync(dir: string, platform: NodeJS.Platform): void {
  if (platform === 'win32') return;
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Sistema de arquivos sem suporte: a troca já foi feita.
  }
}

async function syncDirectory(dir: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') return;
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Sistema de arquivos sem suporte: a troca já foi feita.
  }
}

/** Lê o arquivo (texto); `null` se ele não existe. */
export function readFileIfExistsSync(path: string, platform: NodeJS.Platform = process.platform): string | null {
  try {
    return retryTransientSync(() => readFileSync(path, 'utf8'), platform);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function readFileIfExists(path: string, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  try {
    return await retryTransient(() => readFile(path, 'utf8'), platform);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Grava `data` em `path` de forma atômica e durável (modo 0600 fora do Windows). Bloqueia: para gravações raras. */
export function writeFileDurablySync(path: string, data: string, platform: NodeJS.Platform = process.platform): void {
  const temporary = `${path}.novo`;
  const fd = retryTransientSync(() => openSync(temporary, 'w', 0o600), platform);
  try {
    writeFileSync(fd, data, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  retryTransientSync(() => renameSync(temporary, path), platform);
  syncDirectorySync(dirname(path), platform);
}

/** Como `writeFileDurablySync`, sem bloquear o principal: para as gravações frequentes (a âncora, a cada linha). */
export async function writeFileDurably(path: string, data: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const temporary = `${path}.novo`;
  const handle = await retryTransient(() => open(temporary, 'w', 0o600), platform);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await retryTransient(() => rename(temporary, path), platform);
  await syncDirectory(dirname(path), platform);
}
