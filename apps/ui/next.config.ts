import type { NextConfig } from 'next';

/**
 * Interface do Jesus (decisão 0013): exportação estática, sem servidor. O Electron carrega a pasta `out` pelo
 * protocolo `app://`; tudo o que a interface pede ao sistema passa por IPC. Depois do build, `scripts/csp.mjs`
 * grava em cada página a CSP com os hashes dos scripts inline (seção 3.12).
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // Os pacotes do projeto exportam o código-fonte TypeScript.
  transpilePackages: ['@jesus/auth', '@jesus/core', '@jesus/crypto', '@jesus/hologram', '@jesus/models'],
};

export default config;
