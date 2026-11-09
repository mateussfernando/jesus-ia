import { describe, expect, it } from 'vitest';
import { CHAIN_BROKEN, GENESIS, hashEntry, nextEntry, parseEntry, serializeEntry, toAuditEvent, verifyChain } from './chain';
import type { AuditAnchor, AuditEntry, AuditEvent } from './chain';

const KEY = ['sk-', 'ant-', 'api03-', 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu'].join('');

function chain(count: number, start: AuditAnchor | null = null, first?: AuditEvent): { lines: string[]; entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  let previous = start;
  for (let i = 0; i < count; i++) {
    const event = i === 0 && first !== undefined ? first : { type: 'ferramenta.leitura', path: `C:\\notas\\${String(i)}.txt`, bytes: i * 10 };
    const entry = nextEntry(previous, event, 1_792_000_000_000 + i);
    entries.push(entry);
    previous = { seq: entry.seq, hash: entry.hash };
  }
  return { lines: entries.map(serializeEntry), entries };
}

const anchorOf = (entry: AuditEntry | undefined): AuditAnchor => ({ seq: entry?.seq ?? 0, hash: entry?.hash ?? '' });
const file = (lines: readonly string[]) => lines.map((line) => `${line}\n`).join('');

describe('cadeia do registro de auditoria', () => {
  it('a primeira entrada começa do zero; cada uma liga na anterior; o hash é do JSON canônico sem ele', () => {
    const { entries } = chain(3);
    expect(entries[0]?.seq).toBe(1);
    expect(entries[0]?.prev).toBe(GENESIS);
    expect(entries[1]?.prev).toBe(entries[0]?.hash);
    const { hash, ...body } = entries[2] as AuditEntry;
    expect(hashEntry(body)).toBe(hash);
    expect(parseEntry(serializeEntry(entries[2] as AuditEntry))).toEqual(entries[2]);
  });

  it('cadeia inteira e fim igual à âncora: ok', () => {
    const { lines, entries } = chain(5);
    expect(verifyChain(file(lines), anchorOf(entries.at(-1)))).toMatchObject({ status: 'ok', entries: 5, tornTail: false });
    expect(verifyChain('', null)).toMatchObject({ status: 'ok', entries: 0, last: null });
  });

  it('mudar o conteúdo de uma linha quebra a cadeia naquela linha', () => {
    const { lines, entries } = chain(5);
    const edited = [...lines];
    edited[2] = (edited[2] ?? '').replace('"bytes":20', '"bytes":21');
    expect(verifyChain(file(edited), anchorOf(entries.at(-1)))).toMatchObject({ status: 'tampered', problem: { line: 3 } });
  });

  it('tirar uma linha do meio ou trocar a ordem quebra a cadeia', () => {
    const { lines, entries } = chain(5);
    const anchor = anchorOf(entries.at(-1));
    expect(verifyChain(file([lines[0], lines[1], lines[3], lines[4]] as string[]), anchor).status).toBe('tampered');
    expect(verifyChain(file([lines[0], lines[2], lines[1], lines[3], lines[4]] as string[]), anchor).status).toBe('tampered');
  });

  it('cortar o fim: a cadeia que sobra é válida, mas a âncora acusa', () => {
    const { lines, entries } = chain(5);
    expect(verifyChain(file(lines.slice(0, 3)), anchorOf(entries.at(-1)))).toMatchObject({ status: 'truncated', entries: 3 });
    expect(verifyChain('', anchorOf(entries.at(-1))).status).toBe('truncated');
  });

  it('reescrever tudo com os hashes refeitos: a âncora acusa', () => {
    const { entries } = chain(5);
    const forged: AuditEntry[] = [];
    let previous: AuditAnchor | null = null;
    for (let i = 0; i < 5; i++) {
      const entry = nextEntry(previous, { type: 'ferramenta.leitura', path: 'C:\\outro.txt', bytes: 0 }, 1);
      forged.push(entry);
      previous = { seq: entry.seq, hash: entry.hash };
    }
    expect(verifyChain(file(forged.map(serializeEntry)), anchorOf(entries.at(-1))).status).toBe('tampered');
  });

  it('linhas sem âncora: suspeito; âncora atrás do fim: o app caiu entre a linha e a âncora', () => {
    const { lines, entries } = chain(4);
    expect(verifyChain(file(lines), null).status).toBe('anchor_missing');
    expect(verifyChain(file(lines), anchorOf(entries[2]))).toMatchObject({ status: 'ahead', last: anchorOf(entries[3]) });
  });

  it('linha final sem quebra (gravação interrompida): fica de fora, e a parte válida é medida em bytes', () => {
    const { lines, entries } = chain(3);
    const content = `${file(lines)}${(lines[0] ?? '').slice(0, 20)}`;
    const verdict = verifyChain(content, anchorOf(entries.at(-1)));
    expect(verdict).toMatchObject({ status: 'ok', tornTail: true, entries: 3 });
    expect(verdict.validBytes).toBe(Buffer.byteLength(file(lines)));
  });

  it('forma não canônica, versão desconhecida ou campo a mais são adulteração', () => {
    const { lines, entries } = chain(2);
    const anchor = anchorOf(entries.at(-1));
    const spaced = (lines[1] ?? '').replace('{', '{ ');
    expect(verifyChain(file([lines[0] ?? '', spaced]), anchor).status).toBe('tampered');
    const parsed = JSON.parse(lines[1] ?? '{}') as Record<string, unknown>;
    expect(verifyChain(file([lines[0] ?? '', JSON.stringify({ ...parsed, extra: 1 })]), anchor).status).toBe('tampered');
    expect(parseEntry(JSON.stringify({ ...parsed, v: 2 }))).toBeNull();
  });

  it('cortar o começo: a primeira linha que sobra não começa do zero', () => {
    const { lines, entries } = chain(4);
    expect(verifyChain(file(lines.slice(1)), anchorOf(entries.at(-1)))).toMatchObject({ status: 'tampered', problem: { line: 1 } });
  });

  it('um registro novo pode religar na âncora boa com `audit.chain_broken`', () => {
    const old = chain(3);
    const anchor = anchorOf(old.entries.at(-1));
    const fresh = chain(2, anchor, { type: CHAIN_BROKEN, reason: 'tampered' });
    expect(fresh.entries[0]?.seq).toBe(4);
    expect(verifyChain(file(fresh.lines), anchorOf(fresh.entries.at(-1))).status).toBe('ok');
  });

  it('eventos: segredo mascarado, campo de segredo removido, fração vira texto, tipo conferido', () => {
    const event = toAuditEvent({ type: 'cofre.chave_salva', provider: 'anthropic', apiKey: KEY, nota: `chave ${KEY}`, custo: 0.25, bytes: 3 });
    expect(JSON.stringify(event)).not.toContain(KEY);
    expect(event).toMatchObject({ type: 'cofre.chave_salva', apiKey: '[removido]', custo: '0.25', bytes: 3 });
    expect(() => toAuditEvent({ type: 'SemPonto' })).toThrow();
    expect(() => toAuditEvent({ type: 'a.'.repeat(40) + 'b' })).toThrow();
  });
});
