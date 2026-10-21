import { createRequire } from 'node:module';
import { join } from 'node:path';
import { hardenNetwork, isBlockedBuiltin, isBlockedPackage } from '../brain-host/harden';
import { confineModules } from '../next-host/module-scope';

/**
 * Roda num processo à parte (as travas mudam o processo inteiro e não têm volta): liga as travas do Cérebro, como a
 * entrada `brain-host/main.ts`, e tenta cada caminho de rede. Escreve, para cada um, `blocked` ou `allowed`.
 */
const root = process.argv[2] ?? '';
hardenNetwork();
confineModules(root, (specifier, url) => isBlockedBuiltin(url) || isBlockedPackage(specifier, url));

const requireFromRoot = createRequire(join(root, 'package.json'));
const results: Record<string, string> = {};
async function attempt(name: string, action: () => unknown): Promise<void> {
  try {
    await action();
    results[name] = 'allowed';
  } catch {
    results[name] = 'blocked';
  }
}

const anyGlobal = globalThis as unknown as Record<string, unknown>;
const processInternals = process as unknown as { binding: (name: string) => unknown };
await attempt('fetch', () => fetch('https://example.com/'));
await attempt('WebSocket', () => new WebSocket('wss://example.com/'));
await attempt('EventSource', () => new (anyGlobal['EventSource'] as new (url: string) => unknown)('https://example.com/'));
await attempt('fetch-overwrite', () => {
  anyGlobal['fetch'] = () => 'trocado';
  if ((anyGlobal['fetch'] as () => string)() !== 'trocado') throw new Error('não trocou');
});
await attempt('getBuiltinModule:https', () => process.getBuiltinModule('node:https'));
await attempt('getBuiltinModule:net', () => process.getBuiltinModule('net'));
await attempt('getBuiltinModule:dns', () => process.getBuiltinModule('node:dns'));
await attempt('getBuiltinModule:path', () => process.getBuiltinModule('node:path'));
await attempt('import:node:net', () => import('node:net'));
await attempt('import:http', () => import('http'));
await attempt('require:child_process', () => requireFromRoot('node:child_process'));
await attempt('require:tls', () => requireFromRoot('tls'));
await attempt('require:undici', () => requireFromRoot('undici'));
await attempt('require:zod', () => requireFromRoot('zod'));
await attempt('require:path', () => requireFromRoot('node:path'));
await attempt('binding', () => processInternals.binding('tcp_wrap'));
await attempt('getBuiltinModule:_http_client', () => process.getBuiltinModule('_http_client'));
await attempt('getBuiltinModule:_tls_wrap', () => process.getBuiltinModule('node:_tls_wrap'));
await attempt('getBuiltinModule:worker_threads', () => process.getBuiltinModule('node:worker_threads'));
await attempt('import:worker_threads', () => import('worker_threads'));
await attempt('require:_http_agent', () => requireFromRoot('_http_agent'));
await attempt('dlopen', () => {
  (process as unknown as { dlopen: (module: unknown, filename: string) => void }).dlopen({ exports: {} }, '/nao/existe.node');
  throw new Error('não lançou');
});
await attempt('dlopen-recusado', () => {
  try {
    (process as unknown as { dlopen: (module: unknown, filename: string) => void }).dlopen({ exports: {} }, '/nao/existe.node');
  } catch (error) {
    // A trava diz que é a trava (e não "arquivo não encontrado").
    if (error instanceof Error && error.message.includes('process.dlopen')) return;
  }
  throw new Error('a trava não respondeu');
});
process.stdout.write(JSON.stringify(results));
