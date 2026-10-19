import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileAnchorStore } from './audit-anchor';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jesus-ancora-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('âncora do registro em arquivo (provisória até o cofre)', () => {
  it('sem arquivo, não há âncora; grava e lê de volta', async () => {
    const store = fileAnchorStore(join(dir, 'ancora.json'));
    expect(await store.read()).toBeNull();
    const anchor = { seq: 7, hash: 'a'.repeat(64) };
    await store.write(anchor);
    expect(await store.read()).toEqual(anchor);
    expect(JSON.parse(await readFile(join(dir, 'ancora.json'), 'utf8'))).toEqual(anchor);
  });

  it('âncora estragada ou com campo a mais vale como ausente', async () => {
    const path = join(dir, 'ancora.json');
    const store = fileAnchorStore(path);
    for (const content of ['{', '{"seq":0,"hash":"x"}', JSON.stringify({ seq: 1, hash: 'b'.repeat(64), extra: 1 })]) {
      await writeFile(path, content);
      expect(await store.read(), content).toBeNull();
    }
  });
});
