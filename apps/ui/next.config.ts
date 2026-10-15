import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/** Build do app de desktop (`JESUS_DESKTOP_BUILD=1`): só o necessário para o servidor rodar dentro do Electron. */
const desktopBuild = process.env['JESUS_DESKTOP_BUILD'] === '1';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Interface do Jesus (decisões 0013 e 0016): app Next.js completo, com páginas, Server Actions e rotas no mesmo
 * lugar. No app de desktop, o servidor do Next roda dentro do Electron e atende só a janela do Jesus, sem porta
 * aberta (fase 1). A CSP com nonce sai do `src/proxy.ts` a cada pedido (seção 3.12).
 */
const config: NextConfig = {
  // O standalone copia para `.next/standalone` o servidor e só os módulos que ele usa (rastreados a partir da raiz
  // do repositório, por causa dos workspaces). O `apps/desktop/scripts/stage-ui.mjs` monta o app a partir dele.
  ...(desktopBuild ? { output: 'standalone' as const, outputFileTracingRoot: repoRoot } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // O Next 16 imprime no terminal os argumentos de cada Server Action, e isso inclui a senha local, o código de
  // recuperação e, depois, a chave da API (invariante 5). Também não repassa o console do navegador ao terminal.
  logging: { serverFunctions: false, browserToTerminal: false },
  // Os pacotes do projeto exportam o código-fonte TypeScript.
  transpilePackages: ['@jesus/auth', '@jesus/core', '@jesus/crypto', '@jesus/db', '@jesus/hologram', '@jesus/models'],
};

export default config;
