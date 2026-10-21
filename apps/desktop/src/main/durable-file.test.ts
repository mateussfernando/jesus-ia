import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isTransientFsError,
  readFileIfExists,
  readFileIfExistsSync,
  RETRY_DELAYS_MS,
  retryTransient,
  retryTransientSync,
  writeFileDurably,
  writeFileDurablySync,
} from './durable-file';

const fsError = (code: string) => Object.assign(new Error(code), { code });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jesus-duravel-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('gravação durável', () => {
  it('grava inteiro, sem deixar o temporário, com modo 0600; lê de volta', async () => {
    const path = join(dir, 'a.json');
    expect(readFileIfExistsSync(path)).toBeNull();
    expect(await readFileIfExists(path)).toBeNull();
    writeFileDurablySync(path, '{"a":1}');
    await writeFileDurably(join(dir, 'b.json'), '{"b":2}');
    expect(readFileIfExistsSync(path)).toBe('{"a":1}');
    expect(await readFile(join(dir, 'b.json'), 'utf8')).toBe('{"b":2}');
    expect((await readdir(dir)).sort()).toEqual(['a.json', 'b.json']);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('só EPERM, EACCES e EBUSY no Windows são de passagem', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      expect(isTransientFsError(fsError(code), 'win32')).toBe(true);
      expect(isTransientFsError(fsError(code), 'linux')).toBe(false);
    }
    expect(isTransientFsError(fsError('ENOSPC'), 'win32')).toBe(false);
    expect(isTransientFsError(null, 'win32')).toBe(false);
  });

  it('no Windows, uma falha de passagem é repetida com espera curta, e a falha de verdade não', async () => {
    let calls = 0;
    const slept: number[] = [];
    const flaky = () => {
      calls += 1;
      if (calls < 3) throw fsError('EBUSY');
      return 'ok';
    };
    expect(retryTransientSync(flaky, 'win32', (ms) => slept.push(ms))).toBe('ok');
    expect(slept).toEqual([10, 20]);

    calls = 0;
    expect(() => retryTransientSync(flaky, 'linux', () => undefined)).toThrow('EBUSY');
    expect(calls).toBe(1);

    const full = () => {
      throw fsError('ENOSPC');
    };
    expect(() => retryTransientSync(full, 'win32', () => undefined)).toThrow('ENOSPC');

    // Sem fim: desiste depois das esperas (pouco mais de 1 s ao todo).
    const waits: number[] = [];
    let attempts = 0;
    await expect(
      retryTransient(
        () => {
          attempts += 1;
          return Promise.reject(fsError('EPERM'));
        },
        'win32',
        (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow('EPERM');
    expect(waits).toEqual(RETRY_DELAYS_MS);
    expect(attempts).toBe(RETRY_DELAYS_MS.length + 1);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThan(1_500);
  });
});
