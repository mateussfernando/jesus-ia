import { defineConfig } from 'vitest/config';

/**
 * Testes de ponta a ponta com o Electron (`npm run test:e2e -w @jesus/desktop`). Precisam do build de teste do
 * processo principal (`npm run build:test -w @jesus/desktop`), da interface montada (`npm run stage:ui`) e de um X (no
 * Linux, `xvfb-run -a`). Sem eles, falham (não são pulados).
 */
export default defineConfig({
  test: {
    include: ['src/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
