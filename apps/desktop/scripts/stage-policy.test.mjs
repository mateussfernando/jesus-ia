import { describe, expect, it } from 'vitest';
import { classifyStagePath, isInsideRoot } from './stage-policy.mjs';

describe('montagem da interface para o app', () => {
  it('mantém o servidor do Next, os módulos e os estáticos', () => {
    for (const path of [
      'node_modules/next/dist/server/next.js',
      'node_modules/react-dom/cjs/react-dom-server.node.production.js',
      'apps/ui/.next/required-server-files.json',
      'apps/ui/.next/server/app/entrar/page.js',
      'apps/ui/.next/static/chunks/abc.js',
      'apps/ui/package.json',
      'apps/ui/.next/node_modules/pg-587764f78a6c7a9c/lib/index.js',
    ]) {
      expect(classifyStagePath(path), path).toBe('keep');
    }
  });

  it('tira o sharp (imagens sem otimização) e o server.js (abriria uma porta)', () => {
    expect(classifyStagePath('node_modules/sharp')).toBe('drop');
    expect(classifyStagePath('node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.5.node')).toBe('drop');
    expect(classifyStagePath('node_modules/next/node_modules/@img/x.node')).toBe('drop');
    expect(classifyStagePath('apps/ui/server.js')).toBe('drop');
    expect(classifyStagePath('apps\\ui\\server.js')).toBe('drop');
  });

  it('recusa arquivos de ambiente, credenciais, chaves e bancos', () => {
    for (const path of [
      'apps/ui/.env',
      'apps/ui/.env.local',
      'apps/ui/.ENV.production',
      'apps/ui/.jesus-dev/credentials.json',
      'apps/ui/.jesus-dev',
      'data/credentials.json',
      'credentials.backup.json',
      '.npmrc',
      'node_modules/pkg/.git/config',
      'node_modules/pkg/test/server.key',
      'node_modules/pkg/cert.pem',
      'node_modules/pkg/id_ed25519',
      'node_modules/pkg/cache.sqlite',
      'apps\\ui\\.env',
    ]) {
      expect(classifyStagePath(path), path).toBe('refuse');
    }
  });

  it('recusa módulo nativo fora do que sai em silêncio', () => {
    expect(classifyStagePath('node_modules/bcrypt/build/Release/bcrypt_lib.node')).toBe('refuse');
    expect(classifyStagePath('node_modules/react-dom/server.node.js')).toBe('keep');
  });

  it('link só é seguido para dentro da raiz', () => {
    expect(isInsideRoot('/build/standalone', '/build/standalone/node_modules/pg', '/')).toBe(true);
    expect(isInsideRoot('/build/standalone', '/build/standalone', '/')).toBe(true);
    expect(isInsideRoot('/build/standalone', '/build/standalone-evil/x', '/')).toBe(false);
    expect(isInsideRoot('/build/standalone', '/home/user/.ssh/id_rsa', '/')).toBe(false);
    expect(isInsideRoot('C:\\b\\s', 'C:\\b\\s\\node_modules\\pg', '\\')).toBe(true);
    expect(isInsideRoot('C:\\b\\s', 'C:\\b\\s2\\x', '\\')).toBe(false);
  });
});
