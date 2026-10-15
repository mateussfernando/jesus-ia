import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['src/**/*.integration.test.ts'],
    environment: 'node',
  },
});
