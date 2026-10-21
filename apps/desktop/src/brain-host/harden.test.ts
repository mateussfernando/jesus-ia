import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { isBlockedBuiltin, isBlockedPackage } from './harden';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

describe('travas de rede do Cérebro', () => {
  it('reconhece os módulos de rede com e sem o prefixo node:', () => {
    for (const id of [
      'http',
      'node:http',
      'https',
      'node:net',
      'tls',
      'dgram',
      'node:dns',
      'dns/promises',
      'child_process',
      'node:inspector',
      'worker_threads',
      '_http_client',
      'node:_tls_wrap',
      '_http_agent',
    ]) {
      expect(isBlockedBuiltin(id)).toBe(true);
    }
    for (const id of ['node:path', 'fs', 'node:crypto', 'node:diagnostics_channel', 'node:module', 'file:///x/http.js']) {
      expect(isBlockedBuiltin(id)).toBe(false);
    }
    expect(isBlockedPackage('undici', 'file:///app/node_modules/undici/index.js')).toBe(true);
    expect(isBlockedPackage('./x', 'file:///app/node_modules/undici/lib/fetch.js')).toBe(true);
    expect(isBlockedPackage('ws/lib/x', 'file:///app/x.js')).toBe(true);
    expect(isBlockedPackage('zod', 'file:///app/node_modules/zod/index.js')).toBe(false);
  });

  it('num processo com as travas, todo caminho de rede é recusado (e o resto funciona)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jesus-harden-'));
    try {
      await build({
        input: join(here, '..', 'test-support', 'harden-driver.ts'),
        platform: 'node',
        logLevel: 'silent',
        output: { dir, format: 'esm', entryFileNames: 'driver.mjs' },
      });
      const run = spawnSync(process.execPath, [join(dir, 'driver.mjs'), repoRoot], {
        env: { PATH: process.env['PATH'] ?? '', ...(process.platform === 'win32' ? { SYSTEMROOT: process.env['SYSTEMROOT'] ?? '' } : {}) },
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        fetch: 'blocked',
        WebSocket: 'blocked',
        EventSource: 'blocked',
        'fetch-overwrite': 'blocked',
        'getBuiltinModule:https': 'blocked',
        'getBuiltinModule:net': 'blocked',
        'getBuiltinModule:dns': 'blocked',
        'getBuiltinModule:path': 'allowed',
        'import:node:net': 'blocked',
        'import:http': 'blocked',
        'require:child_process': 'blocked',
        'require:tls': 'blocked',
        'require:undici': 'blocked',
        'require:zod': 'allowed',
        'require:path': 'allowed',
        binding: 'blocked',
        'getBuiltinModule:_http_client': 'blocked',
        'getBuiltinModule:_tls_wrap': 'blocked',
        'getBuiltinModule:worker_threads': 'blocked',
        'import:worker_threads': 'blocked',
        'require:_http_agent': 'blocked',
        dlopen: 'blocked',
        'dlopen-recusado': 'allowed',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
