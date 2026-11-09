import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenNetwork, isBlockedBuiltin, isBlockedPackage } from '../brain-host/harden';
import type { ParentPortLike } from '../bridge/ports';
import { confineModules } from '../next-host/module-scope';

/**
 * Entrada do utilityProcess `jesus-executor` (decisão 0026): as leituras de arquivo rodam aqui, longe do Cérebro e da
 * interface, sem rede e com a busca de módulos presa à raiz do app (as mesmas travas do Cérebro).
 */
const { parentPort } = process as NodeJS.Process & { parentPort?: ParentPortLike };
if (parentPort === undefined) {
  process.stderr.write('[jesus-executor] este arquivo só roda como utilityProcess do Electron\n');
  process.exit(1);
} else {
  hardenNetwork();
  confineModules(
    join(dirname(fileURLToPath(import.meta.url)), '..'),
    (specifier, url) => isBlockedBuiltin(url) || isBlockedPackage(specifier, url),
  );
  const { runExecutorHost } = await import('./executor');
  runExecutorHost(parentPort);
}
