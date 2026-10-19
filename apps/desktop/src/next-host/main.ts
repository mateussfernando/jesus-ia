import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParentPortLike } from '../bridge/ports';
import { runNextHost } from './host';
import { confineModules } from './module-scope';
import { loadNextServer } from './next-server';

/**
 * Entrada do utilityProcess `jesus-next` (decisão 0017): o servidor da interface roda aqui, fora do processo
 * principal, e só conversa pelo `parentPort` e pelos ports de cada pedido. Antes de carregar o Next, a busca de
 * módulos fica presa à raiz do app (no app instalado, o `app.asar`): `dist/` e `stage/` ficam lado a lado.
 */
const { parentPort } = process as NodeJS.Process & { parentPort?: ParentPortLike };
if (parentPort === undefined) {
  process.stderr.write('[jesus-next] este arquivo só roda como utilityProcess do Electron\n');
  process.exit(1);
} else {
  confineModules(join(dirname(fileURLToPath(import.meta.url)), '..'));
  runNextHost(parentPort, loadNextServer);
}
