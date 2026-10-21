import { constants, promises as fsp } from 'node:fs';
import type { BigIntStats, Dir } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

/**
 * O disco do Executor, numa interface pequena: os testes trocam uma função para simular uma troca no meio da conferência
 * (um arquivo virando link entre o `lstat` e o `open`). Os números (`dev`, `ino`, `nlink`, tamanho) vêm em `bigint`:
 * no Windows, o número do arquivo tem 64 bits e não cabe num `number`.
 */
export interface ExecutorFs {
  /** Sem seguir link no último nome. */
  lstat(path: string): Promise<BigIntStats>;
  stat(path: string): Promise<BigIntStats>;
  readlink(path: string): Promise<string>;
  /** O caminho real pelo sistema (`realpath` nativo; no Windows, `GetFinalPathNameByHandle`). */
  realpath(path: string): Promise<string>;
  /** Só leitura, sem seguir link no último nome (onde o sistema deixa) e sem travar num pipe. */
  open(path: string): Promise<FileHandle>;
  opendir(path: string): Promise<Dir>;
}

const optional: Partial<typeof constants> = constants;

/** No Windows, `O_NOFOLLOW`, `O_NONBLOCK` e `O_NOCTTY` não existem: lá, a troca é pega pelo `dev`/`ino` depois de abrir. */
export const READ_FLAGS = constants.O_RDONLY | (optional.O_NOFOLLOW ?? 0) | (optional.O_NONBLOCK ?? 0) | (optional.O_NOCTTY ?? 0);

export const nodeFs: ExecutorFs = {
  lstat: (path) => fsp.lstat(path, { bigint: true }),
  stat: (path) => fsp.stat(path, { bigint: true }),
  readlink: (path) => fsp.readlink(path),
  realpath: (path) => fsp.realpath(path),
  open: (path) => fsp.open(path, READ_FLAGS),
  opendir: (path) => fsp.opendir(path, { bufferSize: 64 }),
};
