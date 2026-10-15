import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

/**
 * Cliente do Prisma sobre o driver `pg` (decisão 0014). Cada processo abre o seu, com a conexão do seu papel de
 * banco (seção 5.3): o processo principal usa `jesus_config`; o Executor, `jesus_app`. A URL vem do cofre na
 * inicialização, nunca de arquivo do repositório.
 */
export function createDbClient(connectionString: string): PrismaClient {
  if (!/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error('a conexão precisa ser uma URL postgresql://');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type { PrismaClient };
