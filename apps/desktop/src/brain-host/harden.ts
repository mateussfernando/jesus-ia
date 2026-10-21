/**
 * Travas de rede do Cérebro (`jesus-brain`; decisão 0023). O Cérebro não fala com a rede: o único caminho para a API é
 * o `fetch` da ponte, que entrega o pedido ao processo principal. Estas travas pegam o que tentaria outro caminho:
 * - `fetch`, `WebSocket` e `EventSource` globais lançam erro (o AI SDK cai neles se ninguém passar um `fetch`);
 * - os módulos de rede do Node e o `undici` não carregam: o `@ai-sdk/provider-utils` baixa arquivos com o `undici` direto,
 *   por `createRequire` e `process.getBuiltinModule`, sem passar pelo `fetch` global;
 * - `process.binding` (o acesso antigo às partes internas do Node, com o TCP cru) lança erro.
 *
 * O utilityProcess não tem a sandbox do Chromium: código que já roda aqui dentro consegue contornar isto. As travas
 * existem contra o uso por acidente (uma dependência que baixa uma URL que veio numa mensagem), não contra execução de
 * código. Contra vazamento, vale o principal: a chave nunca está aqui.
 */

/** Módulos do Node que abrem conexão, resolvem nome ou rodam outro programa. */
export const BLOCKED_BUILTINS: ReadonlySet<string> = new Set([
  'node:http',
  'node:https',
  'node:http2',
  'node:net',
  'node:tls',
  'node:dgram',
  'node:dns',
  'node:dns/promises',
  'node:child_process',
  'node:cluster',
  'node:inspector',
  'node:inspector/promises',
  // Uma thread nova teria globais e busca de módulos próprios, sem as travas desta.
  'node:worker_threads',
  // As peças internas do `http` e do `tls`, que dão um cliente cru sem passar pelos módulos de cima.
  'node:_http_agent',
  'node:_http_client',
  'node:_http_common',
  'node:_http_incoming',
  'node:_http_outgoing',
  'node:_http_server',
  'node:_tls_common',
  'node:_tls_wrap',
  'node:_stream_wrap',
  'node:quic',
]);

/** Pacotes de rede que o AI SDK carrega à parte. */
export const BLOCKED_PACKAGES: readonly string[] = ['undici', 'ws'];

const NO_NETWORK = 'o Cérebro não abre conexões: a rede só sai pelo processo principal';

/** `http`, `node:http` e `node:http/` resolvem para o mesmo módulo do Node. */
export function isBlockedBuiltin(id: string): boolean {
  const name = id.startsWith('node:') ? id : `node:${id}`;
  return BLOCKED_BUILTINS.has(name.replace(/\/$/, ''));
}

/** O pedido de módulo é um pacote de rede (pelo nome) ou um arquivo dentro dele. */
export function isBlockedPackage(specifier: string, resolvedUrl: string): boolean {
  return BLOCKED_PACKAGES.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`) || resolvedUrl.includes(`/node_modules/${name}/`),
  );
}

/** Função que sempre lança, também com `new` (e que serve do lado direito de um `instanceof`). */
function refusing(what: string): () => never {
  return function refused(): never {
    throw new Error(`${what}: ${NO_NETWORK}`);
  };
}

function lockGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: false, configurable: false, enumerable: false });
}

interface ProcessInternals {
  getBuiltinModule?: (id: string) => unknown;
  binding?: (name: string) => unknown;
  dlopen?: (module: unknown, filename: string) => void;
}

/** Liga as travas: chamar uma vez, antes de carregar o AI SDK. */
export function hardenNetwork(target: NodeJS.Process = process): void {
  lockGlobal('fetch', refusing('fetch'));
  lockGlobal('WebSocket', refusing('WebSocket'));
  lockGlobal('EventSource', refusing('EventSource'));

  const internals = target as unknown as ProcessInternals;
  const original = internals.getBuiltinModule?.bind(target);
  if (original !== undefined) {
    Object.defineProperty(target, 'getBuiltinModule', {
      value: (id: string) => {
        if (isBlockedBuiltin(id)) throw new Error(`${id}: ${NO_NETWORK}`);
        return original(id);
      },
      writable: false,
      configurable: false,
    });
  }
  Object.defineProperty(target, 'binding', { value: refusing('process.binding'), writable: false, configurable: false });
  // Módulo nativo (`.node`) é código fora de qualquer trava: o Cérebro não carrega nenhum.
  Object.defineProperty(target, 'dlopen', { value: refusing('process.dlopen'), writable: false, configurable: false });
}
