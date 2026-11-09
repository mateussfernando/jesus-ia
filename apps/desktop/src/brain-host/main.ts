import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParentPortLike } from '../bridge/ports';
import { confineModules } from '../next-host/module-scope';
import { hardenNetwork, isBlockedBuiltin, isBlockedPackage } from './harden';

/**
 * Entrada do utilityProcess `jesus-brain` (decisão 0023): o laço do AI SDK roda aqui, sem a chave da API e sem rede.
 * Antes de carregar o AI SDK, as travas ficam no lugar: `fetch` e `WebSocket` globais que lançam, módulos de rede do
 * Node recusados e a busca de módulos presa à raiz do app (no app instalado, o `app.asar`).
 */
const { parentPort } = process as NodeJS.Process & { parentPort?: ParentPortLike };
if (parentPort === undefined) {
  process.stderr.write('[jesus-brain] este arquivo só roda como utilityProcess do Electron\n');
  process.exit(1);
} else {
  hardenNetwork();
  confineModules(
    join(dirname(fileURLToPath(import.meta.url)), '..'),
    (specifier, url) => isBlockedBuiltin(url) || isBlockedPackage(specifier, url),
  );
  const { runBrainHost } = await import('./brain');
  runBrainHost(parentPort);
}
