import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GatePlacesInput } from './places';
import { checkRequestedPath, checkResolvedPath, createReadPolicy } from './read-gate';
import type { EntryKind, ReadDenial } from './read-gate';
import { checkReleaseFolder } from './release';
import type { ReleaseRefusal } from './release';

/**
 * A coleção de ataques da leitura (`security/attack-corpus/read-paths.json`), rodada inteira a cada mudança no Porteiro
 * (`npm run attack-corpus`). Cada caso passa pelas duas conferências, como no Executor: o caminho pedido e, se ele
 * passar, o caminho real com o que o disco mostraria.
 */

interface CorpusCase {
  readonly id: string;
  readonly requested: string;
  readonly real?: string;
  readonly kind?: EntryKind;
  readonly expected?: 'file' | 'directory';
  readonly links?: number;
  readonly expect: 'allow' | 'deny';
  readonly reason?: string;
  readonly which?: 'requested' | 'real';
  readonly note?: string;
}

interface Corpus {
  readonly places: GatePlacesInput;
  readonly released: readonly string[];
  readonly cases: readonly CorpusCase[];
}

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'security', 'attack-corpus');
const corpus = JSON.parse(readFileSync(join(corpusDir, 'read-paths.json'), 'utf8')) as Corpus;
const policy = createReadPolicy({ released: corpus.released, places: corpus.places });

function reasonOf(denial: ReadDenial): string {
  if (denial.reason === 'path') return `path:${denial.problem}`;
  if (denial.reason === 'sensitive') return `sensitive:${denial.kind}`;
  return denial.reason;
}

function decide(entry: CorpusCase): { decision: 'allow' } | { decision: 'deny'; denial: ReadDenial } {
  const requested = checkRequestedPath(entry.requested, policy);
  if (requested.decision === 'deny') return requested;
  const resolved = checkResolvedPath(
    requested.path,
    { real: entry.real ?? requested.path.text, kind: entry.kind ?? 'file', links: entry.links ?? 1 },
    entry.expected ?? 'file',
    policy,
  );
  return resolved.decision === 'deny' ? resolved : { decision: 'allow' };
}

describe('coleção de ataques: leitura de arquivos', () => {
  it('a coleção tem casos dos dois lados, com nomes únicos', () => {
    const ids = corpus.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(corpus.cases.filter((entry) => entry.expect === 'allow').length).toBeGreaterThan(5);
    expect(corpus.cases.filter((entry) => entry.expect === 'deny').length).toBeGreaterThan(50);
    for (const entry of corpus.cases) if (entry.expect === 'deny') expect(entry.reason, entry.id).toBeDefined();
  });

  it.each(corpus.cases.map((entry) => [`${entry.id}${entry.note === undefined ? '' : ` (${entry.note})`}`, entry] as const))('%s', (_name, entry) => {
    const verdict = decide(entry);
    if (entry.expect === 'allow') {
      expect(verdict).toEqual({ decision: 'allow' });
      return;
    }
    expect(verdict.decision).toBe('deny');
    if (verdict.decision !== 'deny') return;
    expect(reasonOf(verdict.denial)).toBe(entry.reason);
    if (entry.which !== undefined) expect('which' in verdict.denial ? verdict.denial.which : undefined).toBe(entry.which);
  });
});

interface ReleaseCase {
  readonly id: string;
  readonly folder: string;
  readonly expect: 'allow' | 'deny';
  readonly reason?: string;
  readonly note?: string;
}

interface ReleaseCorpus {
  readonly places: GatePlacesInput;
  readonly cases: readonly ReleaseCase[];
}

const releaseCorpus = JSON.parse(readFileSync(join(corpusDir, 'release-folders.json'), 'utf8')) as ReleaseCorpus;
const releasePolicy = createReadPolicy({ released: [], places: releaseCorpus.places });

function refusalOf(refusal: ReleaseRefusal): string {
  if (refusal.reason === 'path') return `path:${refusal.problem}`;
  if (refusal.reason === 'sensitive') return `sensitive:${refusal.kind}`;
  return refusal.reason;
}

describe('coleção de ataques: liberar pastas', () => {
  it('nomes únicos e os dois lados', () => {
    const ids = releaseCorpus.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(releaseCorpus.cases.filter((entry) => entry.expect === 'allow').length).toBeGreaterThan(3);
    for (const entry of releaseCorpus.cases) if (entry.expect === 'deny') expect(entry.reason, entry.id).toBeDefined();
  });

  it.each(releaseCorpus.cases.map((entry) => [`${entry.id}${entry.note === undefined ? '' : ` (${entry.note})`}`, entry] as const))('%s', (_name, entry) => {
    const check = checkReleaseFolder(entry.folder, releasePolicy);
    if (entry.expect === 'allow') {
      expect(check.ok).toBe(true);
      return;
    }
    expect(check.ok).toBe(false);
    if (!check.ok) expect(refusalOf(check.refusal)).toBe(entry.reason);
  });
});
