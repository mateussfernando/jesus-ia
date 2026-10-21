import { defineConfig } from 'prisma/config';

/**
 * Configuração da CLI do Prisma (decisão 0014). A URL só é usada pelas ferramentas de desenvolvimento
 * (`prisma migrate dev`); o `prisma generate` não precisa de banco. Nunca coloque senha aqui: use a variável
 * de ambiente na sua máquina.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['JESUS_DEV_DATABASE_URL'] ?? '' },
});
