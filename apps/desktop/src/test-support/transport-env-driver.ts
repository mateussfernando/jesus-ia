import { rootCertificates } from 'node:tls';
import { createTransport, UpstreamError } from '../main/egress/transport';

/**
 * Roda num processo à parte (o teste põe as variáveis de ambiente que o Node só lê ao iniciar). Modo `pinned`: um
 * pedido pelo transporte da saída, com as autoridades da produção, a um servidor local de autoridade de teste. Modo
 * `control`: o mesmo pedido pelo `fetch` global, que obedece ao ambiente. Escreve o resultado em JSON.
 */
const port = Number(process.argv[2]);
const mode = process.argv[3];
let result: Record<string, unknown>;
if (mode === 'pinned') {
  const transport = createTransport({ host: 'localhost', port, ca: rootCertificates }, { headMs: 5_000, idleMs: 5_000, totalMs: 10_000 });
  try {
    const response = await transport.send({ path: '/', headers: {}, body: Buffer.from('{}') }, new AbortController().signal);
    result = { ok: true, status: response.status };
  } catch (error) {
    result = { ok: false, reason: error instanceof UpstreamError ? error.reason : 'other', message: String(error) };
  }
  transport.close();
} else {
  try {
    const response = await fetch(`https://localhost:${String(port)}/`, { method: 'POST', body: '{}' });
    result = { ok: true, status: response.status };
  } catch (error) {
    result = { ok: false, message: String((error as { cause?: unknown }).cause ?? error) };
  }
}
process.stdout.write(JSON.stringify(result));
