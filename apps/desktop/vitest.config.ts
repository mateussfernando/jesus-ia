import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nos testes de unidade, o código roda como no build de produção (veja src/main/build-flags.ts).
  define: { __JESUS_TEST_BUILD__: 'false' },
  resolve: {
    // Como no empacotamento (scripts/build.mjs): o gateway da Vercel nunca entra no Cérebro.
    alias: { '@ai-sdk/gateway': fileURLToPath(new URL('./src/brain-host/gateway-stub.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['src/**/*.integration.test.ts', 'src/e2e/**'],
    environment: 'node',
    // O `ai` passa pelo Vite (e não direto pelo Node) para o apelido acima valer dentro dele.
    server: { deps: { inline: ['ai'] } },
  },
});
