import { setDefaultResultOrder } from 'node:dns';
import { rootCertificates } from 'node:tls';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestPki } from '../../test-support/certs';
import type { TestPki } from '../../test-support/certs';
import { startTlsServer } from '../../test-support/tls-server';
import type { TestHandler, TestServer } from '../../test-support/tls-server';
import { probeTransportEnv } from '../../test-support/transport-env';
import { ANTHROPIC_TARGET, createTransport, UpstreamError } from './transport';
import type { Transport, TransportTiming, UpstreamResponse } from './transport';

const FAST: TransportTiming = { headMs: 2_000, idleMs: 2_000, totalMs: 10_000 };

let pki: TestPki;
beforeAll(() => {
  setDefaultResultOrder('ipv4first');
  pki = createTestPki();
});

const servers: TestServer[] = [];
const transports: Transport[] = [];
afterEach(async () => {
  for (const transport of transports.splice(0)) transport.close();
  for (const server of servers.splice(0)) await server.close();
});

async function serve(handler: TestHandler): Promise<TestServer> {
  const server = await startTlsServer(pki, handler);
  servers.push(server);
  return server;
}

function transportTo(server: TestServer, options: { ca?: readonly string[]; timing?: TransportTiming } = {}): Transport {
  const transport = createTransport({ host: 'localhost', port: server.port, ca: options.ca ?? [pki.ca] }, options.timing ?? FAST);
  transports.push(transport);
  return transport;
}

async function readAll(response: UpstreamResponse): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of response.body) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

async function failure(promise: Promise<unknown>): Promise<UpstreamError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error;
    throw error;
  }
  throw new Error('era para falhar');
}

describe('createTransport', () => {
  it('na produção, confia só nas autoridades que vêm com o Node, em api.anthropic.com:443', () => {
    expect(ANTHROPIC_TARGET).toEqual({ host: 'api.anthropic.com', port: 443, ca: rootCertificates });
    expect(rootCertificates.length).toBeGreaterThan(50);
  });

  it('manda o POST com os cabeçalhos e o corpo, e devolve a resposta em pedaços', async () => {
    const server = await serve((_req, res, body) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_1' });
      res.write('data: 1\n\n');
      res.end(`data: ${body}\n\n`);
    });
    const response = await transportTo(server).send(
      { path: '/v1/messages', headers: { 'content-type': 'application/json', 'x-api-key': 'k' }, body: Buffer.from('{"a":1}') },
      new AbortController().signal,
    );
    expect(response.status).toBe(200);
    expect(response.headers['request-id']).toBe('req_1');
    expect(await readAll(response)).toBe('data: 1\n\ndata: {"a":1}\n\n');
    expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/v1/messages', body: '{"a":1}' });
    expect(server.requests[0]?.headers['content-length']).toBe('7');
    expect(server.requests[0]?.headers['x-api-key']).toBe('k');
  });

  it('servidor com autoridade fora da lista: recusa, sem mandar o pedido', async () => {
    const server = await serve((_req, res) => res.end('ok'));
    const error = await failure(transportTo(server, { ca: rootCertificates }).send({ path: '/', headers: {}, body: Buffer.from('x') }, new AbortController().signal));
    expect(error.reason).toBe('network');
    expect(error.sent).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  it('NODE_TLS_REJECT_UNAUTHORIZED=0 no próprio processo não desliga a conferência', async () => {
    const server = await serve((_req, res) => res.end('ok'));
    const previous = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    try {
      const error = await failure(transportTo(server, { ca: rootCertificates }).send({ path: '/', headers: {}, body: Buffer.from('x') }, new AbortController().signal));
      expect(error.reason).toBe('network');
    } finally {
      if (previous === undefined) delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
      else process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = previous;
    }
  });

  it('certificado de autoridade aceita, mas para outro nome: recusa, sem mandar o pedido', async () => {
    const other = createTestPki({ dns: ['outro.example'], ips: [] });
    const server = await startTlsServer(other, (_req, res) => res.end('ok'));
    servers.push(server);
    const error = await failure(transportTo(server, { ca: [other.ca] }).send({ path: '/', headers: {}, body: Buffer.from('x') }, new AbortController().signal));
    expect(error.reason).toBe('network');
    expect(error.message).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(error.sent).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  it('sinal já cancelado: recusa sem abrir conexão (e sem erro solto no processo)', async () => {
    const server = await serve((_req, res) => res.end('ok'));
    const controller = new AbortController();
    controller.abort();
    const error = await failure(transportTo(server).send({ path: '/', headers: { 'x-api-key': 'k' }, body: Buffer.from('x') }, controller.signal));
    expect(error.reason).toBe('aborted');
    expect(error.sent).toBe(false);
    // Um `error` sem ouvinte apareceria aqui como erro não tratado (o vitest falha o arquivo).
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(server.requests).toHaveLength(0);
  });

  it('cabeçalho inválido: falha sem mandar nada', async () => {
    const server = await serve((_req, res) => res.end('ok'));
    const error = await failure(transportTo(server).send({ path: '/', headers: { 'x-api-key': 'a\r\nb' }, body: Buffer.from('x') }, new AbortController().signal));
    expect(error).toMatchObject({ reason: 'network', sent: false, message: 'cabeçalho inválido' });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(server.requests).toHaveLength(0);
  });

  it('não segue redirecionamento', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(307, { location: 'https://atacante.example/' });
      res.end();
    });
    const error = await failure(transportTo(server).send({ path: '/', headers: {}, body: Buffer.from('x') }, new AbortController().signal));
    expect(error.reason).toBe('redirect');
    expect(server.requests).toHaveLength(1);
  });

  it('sem resposta no prazo: timeout', async () => {
    const server = await serve(() => undefined);
    const error = await failure(
      transportTo(server, { timing: { headMs: 200, idleMs: 2_000, totalMs: 10_000 } }).send(
        { path: '/', headers: {}, body: Buffer.from('x') },
        new AbortController().signal,
      ),
    );
    expect(error.reason).toBe('timeout');
    expect(error.sent).toBe(true);
  });

  it('resposta parada no meio: a leitura termina em timeout', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: 1\n\n');
    });
    const response = await transportTo(server, { timing: { headMs: 2_000, idleMs: 200, totalMs: 10_000 } }).send(
      { path: '/', headers: {}, body: Buffer.from('x') },
      new AbortController().signal,
    );
    expect((await failure(readAll(response))).reason).toBe('timeout');
  });

  it('conexão cortada no meio: a leitura falha, nunca termina como se a resposta estivesse inteira', async () => {
    const server = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': '1000' });
      res.write('data: 1\n\n');
      setTimeout(() => req.socket.destroy(), 50);
    });
    const response = await transportTo(server).send({ path: '/', headers: {}, body: Buffer.from('x') }, new AbortController().signal);
    expect((await failure(readAll(response))).reason).toBe('network');
  });

  it('cancelamento antes e depois do cabeçalho', async () => {
    const hang = await serve(() => undefined);
    const before = new AbortController();
    const pending = transportTo(hang).send({ path: '/', headers: {}, body: Buffer.from('x') }, before.signal);
    setTimeout(() => before.abort(), 50);
    expect((await failure(pending)).reason).toBe('aborted');

    const stream = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: 1\n\n');
    });
    const during = new AbortController();
    const response = await transportTo(stream).send({ path: '/', headers: {}, body: Buffer.from('x') }, during.signal);
    setTimeout(() => during.abort(), 50);
    expect((await failure(readAll(response))).reason).toBe('aborted');
  });

  it('o ambiente (autoridades extras, conferência desligada, proxy, depuração) não muda a saída nem mostra a chave', async () => {
    const result = await probeTransportEnv(process.execPath);
    // Recusado pela autoridade (e não por outro motivo, como porta ou IPv6).
    expect(result.pinned).toMatchObject({ ok: false, reason: 'network', message: expect.stringContaining('UNABLE_TO_VERIFY_LEAF_SIGNATURE') });
    expect(result.pinnedProxied).toBe(0);
    // Com NODE_DEBUG=*, o Node imprime as opções de cada conexão (o controle), mas a chave do cabeçalho não aparece.
    expect(result.pinnedDebugLines).toBeGreaterThan(0);
    expect(result.pinnedLeakedKey).toBe(false);
    // Controle: no mesmo ambiente, o `fetch` global confia na autoridade de teste (as variáveis valem neste Node).
    expect(result.control).toMatchObject({ ok: true });
    // O proxy pelo ambiente existe a partir do Node 24 (o do Electron 44 e o do CI).
    if (Number(process.versions.node.split('.')[0]) >= 24) expect(result.controlProxied).toBeGreaterThan(0);
  }, 30_000);
});
