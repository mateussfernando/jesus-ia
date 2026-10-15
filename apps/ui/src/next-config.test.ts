import { describe, expect, it } from 'vitest';
import config from '../next.config';

describe('configuração do Next', () => {
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
});
