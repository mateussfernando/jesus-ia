import { defineConfig } from 'vitest/config';

/**
 * Testes de integração com o build de verdade da interface (`npm run test:integration -w @jesus/desktop`). Precisam
 * do build standalone montado (`JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w
 * @jesus/desktop`) ou de `JESUS_UI_DIR` apontando para um build do `apps/ui`. Sem ele, falham (não são pulados).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
