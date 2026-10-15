import type { ParentPortLike } from '../bridge/ports';
import { runNextHost } from './host';
import { loadNextServer } from './next-server';

/**
 * Entrada do utilityProcess `jesus-next` (decisão 0017): o servidor da interface roda aqui, fora do processo
 * principal, e só conversa pelo `parentPort` e pelos ports de cada pedido.
 */
const { parentPort } = process as NodeJS.Process & { parentPort?: ParentPortLike };
if (parentPort === undefined) {
  process.stderr.write('[jesus-next] este arquivo só roda como utilityProcess do Electron\n');
  process.exit(1);
} else {
  runNextHost(parentPort, loadNextServer);
}
