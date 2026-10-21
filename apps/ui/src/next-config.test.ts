import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../next.config';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('configuração do Next', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('não imprime os argumentos das Server Actions (senha, código, chave) nem o console do navegador', () => {
    expect(config.logging).not.toBe(undefined);
    if (config.logging === false || config.logging === undefined) return;
    expect(config.logging.serverFunctions).toBe(false);
    expect(config.logging.browserToTerminal).toBe(false);
  });

  it('não anuncia o servidor e sempre usa barra no fim', () => {
    expect(config.poweredByHeader).toBe(false);
    expect(config.trailingSlash).toBe(true);
  });

  it('o build comum não é standalone; o do app de desktop é, rastreado da raiz do repositório', async () => {
    expect(config.output).toBeUndefined();
    vi.stubEnv('JESUS_DESKTOP_BUILD', '1');
    vi.resetModules();
    const desktop = (await import('../next.config')).default;
    expect(desktop.output).toBe('standalone');
    expect(desktop.outputFileTracingRoot).toBe(repoRoot);
    expect(desktop.logging).toEqual(config.logging);
  });
});
