import type { NextConfig } from 'next';

/**
 * Interface do Jesus (decisões 0013 e 0016): app Next.js completo, com páginas, Server Actions e rotas no mesmo
 * lugar. No app de desktop, o servidor do Next roda dentro do Electron e atende só a janela do Jesus, sem porta
 * aberta (fase 1). A CSP com nonce sai do `src/proxy.ts` a cada pedido (seção 3.12).
 */
const config: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // Os pacotes do projeto exportam o código-fonte TypeScript.
  transpilePackages: ['@jesus/auth', '@jesus/core', '@jesus/crypto', '@jesus/db', '@jesus/hologram', '@jesus/models'],
};

export default config;
