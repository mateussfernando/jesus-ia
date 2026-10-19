import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAIN_BROKEN, parseEntry, verifyChain } from './chain';
import type { AuditAnchor } from './chain';
import { AuditWriter } from './writer';
import type { AnchorStore } from './writer';

const KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');

/** Âncora em memória (no app, fica no cofre a partir da etapa 8). */
class MemoryAnchors implements AnchorStore {
  value: AuditAnchor | null = null;
  failNext = false;
  read() {
    return Promise.resolve(this.value);
  }
  write(anchor: AuditAnchor) {
    if (this.failNext) return Promise.reject(new Error('cofre indisponível'));
    this.value = anchor;
    return Promise.resolve();
  }
}

let dir: string;
let path: string;
let anchors: MemoryAnchors;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jesus-audit-'));
  path = join(dir, 'audit.jsonl');
  anchors = new MemoryAnchors();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeEvents(count: number): Promise<void> {
  const { writer } = await AuditWriter.open({ path, anchors });
  for (let i = 0; i < count; i++) await writer.append({ type: 'ferramenta.leitura', n: i });
  await writer.close();
}

const lines = async () => (await readFile(path, 'utf8')).trimEnd().split('\n');

describe('escritor do registro de auditoria', () => {
  it('grava, avança a âncora a cada linha e continua de onde parou ao abrir de novo', async () => {
    await writeEvents(3);
    expect(await lines()).toHaveLength(3);
    expect(anchors.value?.seq).toBe(3);
    const { writer, verdict } = await AuditWriter.open({ path, anchors });
    expect(verdict.status).toBe('ok');
    const entry = await writer.append({ type: 'ferramenta.leitura', n: 3 });
    await writer.close();
    expect(entry.seq).toBe(4);
    expect(verifyChain(await readFile(path, 'utf8'), anchors.value).status).toBe('ok');
  });

  it('chamadas ao mesmo tempo saem em fila, na ordem', async () => {
    const { writer } = await AuditWriter.open({ path, anchors });
    const entries = await Promise.all(Array.from({ length: 20 }, (_, n) => writer.append({ type: 'ferramenta.leitura', n })));
    await writer.close();
    expect(entries.map((entry) => entry.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(verifyChain(await readFile(path, 'utf8'), anchors.value)).toMatchObject({ status: 'ok', entries: 20 });
  });

  it('segredos não chegam ao arquivo', async () => {
    const { writer } = await AuditWriter.open({ path, anchors });
    await writer.append({ type: 'cofre.chave_salva', apiKey: KEY, nota: `colou ${KEY}`, password: 'hunter2' });
    await writer.close();
    const content = await readFile(path, 'utf8');
    expect(content).not.toContain(KEY);
    expect(content).not.toContain('hunter2');
  });

  it('linha incompleta no fim (queda no meio da gravação): é cortada e o reparo fica registrado', async () => {
    await writeEvents(2);
    await writeFile(path, `${await readFile(path, 'utf8')}{"v":1,"seq":3,"ts`, { flag: 'w' });
    const { writer, verdict, quarantined } = await AuditWriter.open({ path, anchors });
    await writer.close();
    expect(verdict).toMatchObject({ status: 'ok', tornTail: true });
    expect(quarantined).toBeNull();
    const all = await lines();
    expect(all).toHaveLength(3);
    expect(parseEntry(all[2] ?? '')?.event).toEqual({ type: 'audit.recovered', reason: 'torn_tail' });
    expect(verifyChain(await readFile(path, 'utf8'), anchors.value).status).toBe('ok');
  });

  it('âncora atrás do fim (queda entre a linha e a âncora): a âncora alcança o fim', async () => {
    await writeEvents(3);
    const finalAnchor = anchors.value;
    await writeEvents(0);
    const content = await readFile(path, 'utf8');
    anchors.value = { seq: 2, hash: parseEntry(content.split('\n')[1] ?? '')?.hash ?? '' };
    const { writer, verdict } = await AuditWriter.open({ path, anchors });
    await writer.close();
    expect(verdict.status).toBe('ahead');
    expect(anchors.value).toEqual(finalAnchor);
  });

  it('arquivo adulterado: vai para o lado como prova e um registro novo começa ligado à âncora boa', async () => {
    await writeEvents(3);
    const good = anchors.value;
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace('"n":1', '"n":7'));
    const { writer, verdict, quarantined } = await AuditWriter.open({ path, anchors });
    await writer.append({ type: 'ferramenta.leitura', n: 99 });
    await writer.close();
    expect(verdict).toMatchObject({ status: 'tampered', problem: { line: 2 } });
    expect(quarantined).not.toBeNull();
    expect(await readFile(quarantined ?? '', 'utf8')).toBe(original.replace('"n":1', '"n":7'));
    const fresh = await lines();
    const first = parseEntry(fresh[0] ?? '');
    expect(first?.event).toMatchObject({ type: CHAIN_BROKEN, reason: 'tampered', line: 2 });
    expect(first?.seq).toBe((good?.seq ?? 0) + 1);
    expect(first?.prev).toBe(good?.hash);
    expect(verifyChain(await readFile(path, 'utf8'), anchors.value).status).toBe('ok');
  });

  it('arquivo apagado com a âncora no lugar: registro novo que acusa o corte', async () => {
    await writeEvents(2);
    await unlink(path);
    const { writer, verdict, quarantined } = await AuditWriter.open({ path, anchors });
    await writer.close();
    expect(verdict.status).toBe('truncated');
    expect(quarantined).toBeNull();
    expect(parseEntry((await lines())[0] ?? '')?.event).toMatchObject({ type: CHAIN_BROKEN, reason: 'truncated' });
  });

  it('linhas sem âncora (a âncora sumiu ou o arquivo foi trocado): vai para o lado também', async () => {
    await writeEvents(2);
    anchors.value = null;
    const { writer, verdict, quarantined } = await AuditWriter.open({ path, anchors });
    await writer.close();
    expect(verdict.status).toBe('anchor_missing');
    expect(quarantined).not.toBeNull();
    expect((await readdir(dir)).filter((name) => name.includes('.adulterado-'))).toHaveLength(1);
    const first = parseEntry((await lines())[0] ?? '');
    expect(first?.seq).toBe(1);
  });

  it('falha de gravação: a chamada falha e o escritor para (o estado do arquivo é incerto)', async () => {
    const { writer } = await AuditWriter.open({ path, anchors });
    anchors.failNext = true;
    await expect(writer.append({ type: 'ferramenta.leitura', n: 1 })).rejects.toThrow('cofre indisponível');
    anchors.failNext = false;
    await expect(writer.append({ type: 'ferramenta.leitura', n: 2 })).rejects.toThrow('indisponível');
    await writer.close();
  });
});
