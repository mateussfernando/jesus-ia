import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Os testes de integração criam um banco próprio cada um; rodar um arquivo por vez evita disputa de papéis.
    fileParallelism: false,
  },
});
