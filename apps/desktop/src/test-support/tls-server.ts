import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import type { TestPki } from './certs';

/** Servidor HTTPS local para os testes, com o certificado da autoridade de teste. */
export interface TestServer {
  readonly port: number;
  readonly requests: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[];
  close(): Promise<void>;
}

export type TestHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export async function startTlsServer(pki: TestPki, handler: TestHandler): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const sockets = new Set<Socket>();
  const server = createServer({ cert: pki.server.cert, key: pki.server.key }, (req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => parts.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  server.on('secureConnection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  // TLS recusado do lado do cliente não é erro do teste.
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('servidor de teste sem porta');
  return {
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Proxy HTTP local (só CONNECT) que conta as conexões: nenhuma deve vir da saída para a API. */
export async function startConnectProxy(): Promise<{ readonly port: number; connections(): number; close(): Promise<void> }> {
  let connections = 0;
  const sockets = new Set<Socket>();
  const proxy = createHttpServer();
  proxy.on('connect', (req: IncomingMessage, socket: Socket) => {
    connections += 1;
    sockets.add(socket);
    const [host = '127.0.0.1', port = '443'] = (req.url ?? '').split(':');
    const upstream = connect(Number(port), host === 'localhost' ? '127.0.0.1' : host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (address === null || typeof address === 'string') throw new Error('proxy de teste sem porta');
  return {
    port: address.port,
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        proxy.close(() => resolve());
      }),
  };
}
