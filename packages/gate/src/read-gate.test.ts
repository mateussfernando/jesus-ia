import { describe, expect, it } from 'vitest';
import { describeDenial, describeRelease } from './describe';
import { createPlaces } from './places';
import { checkRequestedPath, checkResolvedPath, createReadPolicy } from './read-gate';
import type { ReadDenial } from './read-gate';
import { checkReleaseFolder } from './release';
import type { ReleaseRefusal } from './release';
import { sensitiveKind } from './sensitive';
import type { SensitiveKind } from './sensitive';
import { windowsPath } from './path';
import type { PathProblem } from './path';

const PLACES = {
  home: 'C:\\Users\\Mateus',
  localAppData: 'C:\\Users\\Mateus\\AppData\\Local',
  roamingAppData: 'C:\\Users\\Mateus\\AppData\\Roaming',
};
const SITE = 'C:\\Users\\Mateus\\Projetos\\site';

describe('Porteiro da leitura', () => {
  it('a segunda conferência confere o pedido de novo: a pasta pode ter deixado de ser liberada', () => {
    const before = createReadPolicy({ released: [SITE], places: PLACES });
    const first = checkRequestedPath(`${SITE}\\a.txt`, before);
    if (first.decision !== 'allow') throw new Error('era para passar');
    const after = createReadPolicy({ released: [], places: PLACES });
    expect(checkResolvedPath(first.path, { real: first.path.text, kind: 'file', links: 1 }, 'file', after)).toEqual({
      decision: 'deny',
      denial: { reason: 'outside', which: 'requested' },
    });
  });

  it('libera com o caminho pedido e o real normalizados', () => {
    const policy = createReadPolicy({ released: [SITE], places: PLACES });
    const first = checkRequestedPath('c:/users/mateus/projetos/site/link.txt', policy);
    if (first.decision !== 'allow') throw new Error('era para passar');
    const verdict = checkResolvedPath(first.path, { real: `${SITE}\\docs\\a.txt`, kind: 'file', links: 1 }, 'file', policy);
    expect(verdict.decision).toBe('allow');
    if (verdict.decision === 'allow') {
      expect(verdict.path.text).toBe('C:\\users\\mateus\\projetos\\site\\link.txt');
      expect(verdict.real.text).toBe(`${SITE}\\docs\\a.txt`);
    }
  });

  it('pasta: número de nomes não importa (só arquivo tem hardlink)', () => {
    const policy = createReadPolicy({ released: [SITE], places: PLACES });
    const first = checkRequestedPath(SITE, policy);
    if (first.decision !== 'allow') throw new Error('era para passar');
    expect(checkResolvedPath(first.path, { real: SITE, kind: 'directory', links: 3 }, 'directory', policy).decision).toBe('allow');
    expect(checkResolvedPath(first.path, { real: SITE, kind: 'file', links: Number.NaN }, 'file', policy)).toMatchObject({
      decision: 'deny',
      denial: { reason: 'hardlink' },
    });
  });

  it('configuração com caminho inválido é erro de programação', () => {
    expect(() => createReadPolicy({ released: ['relativo'], places: PLACES })).toThrow();
    expect(() => createReadPolicy({ released: [SITE], places: { ...PLACES, home: '\\\\servidor\\casa' } })).toThrow();
  });

  it('as pastas do Jesus conhecidas entram sozinhas, mais as que o principal mandar', () => {
    const places = createPlaces({ ...PLACES, jesus: ['E:\\Jesus\\dados'] });
    expect(places.jesus.map((place) => place.text)).toEqual([
      'C:\\Users\\Mateus\\AppData\\Local\\Jesus',
      'C:\\Users\\Mateus\\AppData\\Local\\Jesus (teste)',
      'C:\\Users\\Mateus\\AppData\\Local\\Programs\\Jesus',
      'E:\\Jesus\\dados',
    ]);
    const policy = createReadPolicy({ released: ['E:\\'], places: { ...PLACES, jesus: ['E:\\Jesus\\dados'] } });
    expect(checkRequestedPath('E:\\Jesus\\dados\\vault.json', policy)).toEqual({ decision: 'deny', denial: { reason: 'jesus', which: 'requested' } });
    expect(checkRequestedPath('E:\\Jesus\\outra\\a.txt', policy).decision).toBe('allow');
  });

  it('sem a pasta do sistema, as regras dela ficam de fora (o resto continua)', () => {
    const places = createPlaces(PLACES);
    expect(places.systemRoot).toBeNull();
    expect(sensitiveKind(windowsPath('C:\\Windows\\System32\\config\\SAM'), places)).toBeNull();
    expect(sensitiveKind(windowsPath('C:\\Users\\Mateus\\AppData\\Roaming\\Microsoft\\Protect\\x'), places)).toBe('windows');
    expect(sensitiveKind(windowsPath(`${SITE}\\index.html`), places)).toBeNull();
    expect(sensitiveKind(windowsPath(`${SITE}\\NTUSER.DAT`), places)).toBeNull();
  });
});

describe('a negação em texto', () => {
  const problems: PathProblem[] = [
    'empty',
    'too_long',
    'control_char',
    'invalid_char',
    'not_absolute',
    'unc',
    'device_namespace',
    'stream',
    'trailing_dot_space',
    'reserved_name',
    'short_name',
  ];
  const kinds: SensitiveKind[] = ['ssh', 'credentials', 'browser', 'password_manager', 'windows', 'private_key', 'env_file', 'crypto_wallet', 'app_session'];

  it('cada motivo tem um texto próprio, que nunca repete o caminho', () => {
    const denials: ReadDenial[] = [
      ...problems.flatMap((problem) => (['requested', 'real'] as const).map((which) => ({ reason: 'path', which, problem }) as const)),
      ...kinds.flatMap((kind) => (['requested', 'real'] as const).map((which) => ({ reason: 'sensitive', which, kind }) as const)),
      { reason: 'jesus', which: 'requested' },
      { reason: 'jesus', which: 'real' },
      { reason: 'outside', which: 'requested' },
      { reason: 'outside', which: 'real' },
      { reason: 'kind', expected: 'file', actual: 'directory' },
      { reason: 'kind', expected: 'directory', actual: 'file' },
      { reason: 'kind', expected: 'file', actual: 'other' },
      { reason: 'hardlink', links: 2 },
    ];
    const texts = denials.map(describeDenial);
    for (const text of texts) expect(text.length).toBeGreaterThan(20);
    // Os de caminho inválido dizem o mesmo para o pedido e o real; o resto é diferente entre si.
    expect(new Set(texts).size).toBe(texts.length - problems.length);
    expect(describeDenial({ reason: 'outside', which: 'real' })).toContain('link');
  });
});

describe('Porteiro com caminhos POSIX (testes e desenvolvimento no Linux)', () => {
  const policy = createReadPolicy({
    platform: 'posix',
    released: ['/home/mateus/projetos/site'],
    places: { home: '/home/mateus', localAppData: '/home/mateus/.config', roamingAppData: '/home/mateus/.config', jesus: ['/tmp/jesus-e2e/data'] },
  });

  it('libera dentro da pasta liberada e nega fora, a pasta do Jesus e o sensível', () => {
    expect(checkRequestedPath('/home/mateus/projetos/site/index.html', policy).decision).toBe('allow');
    expect(checkRequestedPath('/home/mateus/projetos/Site/index.html', policy)).toEqual({ decision: 'deny', denial: { reason: 'outside', which: 'requested' } });
    expect(checkRequestedPath('/home/mateus/.config/Jesus/data/vault.json', policy)).toMatchObject({ decision: 'deny', denial: { reason: 'jesus' } });
    expect(checkRequestedPath('/tmp/jesus-e2e/data/audit.jsonl', policy)).toMatchObject({ decision: 'deny', denial: { reason: 'jesus' } });
    expect(checkRequestedPath('/home/mateus/projetos/site/.env', policy)).toMatchObject({ decision: 'deny', denial: { reason: 'sensitive', kind: 'env_file' } });
    expect(checkRequestedPath('/home/mateus/projetos/site/.SSH/config', policy)).toMatchObject({ decision: 'deny', denial: { reason: 'sensitive', kind: 'ssh' } });
    expect(checkRequestedPath('C:\\Users\\mateus\\a.txt', policy)).toMatchObject({ decision: 'deny', denial: { reason: 'path', problem: 'not_absolute' } });
  });

  it('o caminho real também vale no POSIX (link para fora)', () => {
    const first = checkRequestedPath('/home/mateus/projetos/site/link', policy);
    if (first.decision !== 'allow') throw new Error('era para passar');
    expect(checkResolvedPath(first.path, { real: '/home/mateus/.mozilla/firefox/x/logins.json', kind: 'file', links: 1 }, 'file', policy)).toMatchObject({
      decision: 'deny',
      denial: { reason: 'sensitive', kind: 'browser', which: 'real' },
    });
  });

  it('liberar pasta no POSIX segue as mesmas regras', () => {
    const release = createReadPolicy({
      platform: 'posix',
      released: [],
      places: { home: '/home/mateus', localAppData: '/home/mateus/.config', roamingAppData: '/home/mateus/.config', personal: ['/home/mateus/Documentos'], system: ['/etc', '/usr'] },
    });
    expect(checkReleaseFolder('/home/mateus/projetos', release).ok).toBe(true);
    expect(checkReleaseFolder('/home/mateus/Documentos/escola', release).ok).toBe(true);
    for (const [folder, reason] of [
      ['/', 'root'],
      ['/home', 'too_broad'],
      ['/home/mateus', 'too_broad'],
      ['/home/mateus/Documentos', 'personal'],
      ['/home/mateus/.config/algum', 'app_data'],
      ['/home/mateus/.config/Jesus', 'jesus'],
      ['/etc/ssl', 'system'],
      ['/usr', 'system'],
    ] as const) {
      const check = checkReleaseFolder(folder, release);
      expect(check.ok ? 'ok' : check.refusal.reason, folder).toBe(reason);
    }
  });
});

describe('o motivo de não liberar a pasta, em texto', () => {
  it('cada motivo tem um texto próprio', () => {
    const refusals: ReleaseRefusal[] = [
      { reason: 'path', problem: 'unc' },
      { reason: 'root' },
      { reason: 'jesus' },
      { reason: 'sensitive', kind: 'ssh' },
      { reason: 'too_broad' },
      { reason: 'personal' },
      { reason: 'system' },
      { reason: 'app_data' },
    ];
    const texts = refusals.map(describeRelease);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text.length).toBeGreaterThan(20);
  });
});
