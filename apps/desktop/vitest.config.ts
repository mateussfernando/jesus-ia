import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nos testes de unidade, o código roda como no build de produção (veja src/main/build-flags.ts).
  define: { __JESUS_TEST_BUILD__: 'false' },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['src/**/*.integration.test.ts', 'src/e2e/**'],
    environment: 'node',
  },
});
