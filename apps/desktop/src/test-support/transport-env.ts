import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import { createTestPki } from './certs';
import { startConnectProxy, startTlsServer } from './tls-server';

/**
 * Prova de que o ambiente não muda a saída para a API (decisão 0023): num processo novo (as variáveis abaixo o Node só
 * lê ao iniciar), com a autoridade de teste em `NODE_EXTRA_CA_CERTS` e em `SSL_CERT_FILE` (com `NODE_USE_SYSTEM_CA`),
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` e `NODE_USE_ENV_PROXY` com `HTTPS_PROXY` apontando para um proxy local, o
 * transporte com as autoridades da produção tem de recusar o servidor de teste, sem passar pelo proxy. O `fetch` global
 * do mesmo processo serve de controle: ele obedece a essas variáveis.
 */

export interface EnvProbeResult {
  /** O transporte da saída, com as autoridades da produção: tem de falhar. */
  readonly pinned: { readonly ok: boolean; readonly reason?: string; readonly message?: string };
  /** Conexões do transporte que chegaram ao proxy: tem de ser zero. */
  readonly pinnedProxied: number;
  /** O `fetch` global no mesmo ambiente (controle): com o ambiente valendo, ele confia na autoridade de teste. */
  readonly control: { readonly ok: boolean; readonly message?: string };
  readonly controlProxied: number;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Empacota o driver num arquivo só, para rodar em qualquer Node (inclusive o do Electron). */
async function bundleDriver(dir: string): Promise<string> {
  await build({
    input: join(here, 'transport-env-driver.ts'),
    platform: 'node',
    logLevel: 'silent',
    output: { dir, format: 'esm', entryFileNames: 'driver.mjs' },
  });
  return join(dir, 'driver.mjs');
}

function run(command: string, args: string[], env: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`driver saiu com ${String(code)}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`saída inválida do driver: ${stdout} ${stderr}`));
      }
    });
  });
}

export async function probeTransportEnv(command: string, extraEnv: Readonly<Record<string, string>> = {}): Promise<EnvProbeResult> {
  const pki = createTestPki();
  const dir = mkdtempSync(join(tmpdir(), 'jesus-transport-env-'));
  const server = await startTlsServer(pki, (_req, res) => res.end('ok'));
  const proxy = await startConnectProxy();
  try {
    const caFile = join(dir, 'ca.pem');
    writeFileSync(caFile, pki.ca);
    const driver = await bundleDriver(dir);
    // Ambiente mínimo e controlado: nada do ambiente de quem roda o teste (que pode ter proxy e autoridades próprios).
    const env: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      ...(process.platform === 'win32' ? { SYSTEMROOT: process.env['SYSTEMROOT'] ?? 'C:\\Windows' } : {}),
      NODE_EXTRA_CA_CERTS: caFile,
      NODE_USE_SYSTEM_CA: '1',
      SSL_CERT_FILE: caFile,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: `http://127.0.0.1:${String(proxy.port)}`,
      https_proxy: `http://127.0.0.1:${String(proxy.port)}`,
      ...extraEnv,
    };
    const args = (mode: string) => ['--dns-result-order=ipv4first', driver, String(server.port), mode];
    const pinned = await run(command, args('pinned'), env);
    const pinnedProxied = proxy.connections();
    const control = await run(command, args('control'), env);
    return {
      pinned: pinned as EnvProbeResult['pinned'],
      pinnedProxied,
      control: control as EnvProbeResult['control'],
      controlProxied: proxy.connections() - pinnedProxied,
    };
  } finally {
    await server.close();
    await proxy.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
