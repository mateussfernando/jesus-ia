import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { probeTransportEnv } from '../test-support/transport-env';

/**
 * O transporte da saída para a API no Node do próprio Electron 44.7.0 (o do processo principal), e não só no Node dos
 * testes de unidade (decisão 0023): com `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_TLS_REJECT_UNAUTHORIZED=0`
 * e `NODE_USE_ENV_PROXY` com `HTTPS_PROXY` no ambiente, ele continua recusando o servidor de outra autoridade e não
 * passa pelo proxy, enquanto o `fetch` global do mesmo processo obedece a tudo isso (o controle). Com `NODE_DEBUG=*`,
 * a chave do cabeçalho não aparece na saída do processo.
 */
const electronPath = createRequire(import.meta.url)('electron') as string;

describe('saída para a API no Node do Electron', () => {
  it('o ambiente não muda o transporte', async () => {
    const result = await probeTransportEnv(electronPath, { ELECTRON_RUN_AS_NODE: '1' });
    expect(result.pinned).toMatchObject({ ok: false, reason: 'network', message: expect.stringContaining('UNABLE_TO_VERIFY_LEAF_SIGNATURE') });
    expect(result.pinnedProxied).toBe(0);
    expect(result.pinnedDebugLines).toBeGreaterThan(0);
    expect(result.pinnedLeakedKey).toBe(false);
    expect(result.control).toMatchObject({ ok: true });
    expect(result.controlProxied).toBeGreaterThan(0);
  });
});
