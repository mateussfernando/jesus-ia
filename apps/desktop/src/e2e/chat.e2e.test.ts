import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerEvents, messageStart, textBlock } from '../test-support/anthropic-sse';
import { createTestPki } from '../test-support/certs';
import type { TestPki } from '../test-support/certs';
import { startTlsServer } from '../test-support/tls-server';
import type { TestServer } from '../test-support/tls-server';
import { APP, launchApp, reportFailures } from './harness';
import type { RunningApp } from './harness';

/**
 * A conversa no app de verdade (etapa 11; decisões 0024 e 0025): a tela manda a pergunta pela rota do turno → servidor
 * da interface → principal → Cérebro (AI SDK) → saída para a API no principal (conferência, chave, teto, registro) →
 * transporte HTTPS de verdade até um servidor local com respostas SSE roteirizadas, e a resposta volta em pedaços até a
 * tela. O destino local e a chave falsa só existem no build de teste (`__jesusTest.useTestApi`).
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainEntry = join(desktopDir, 'dist-test', 'main.mjs');
const executable = process.env['JESUS_E2E_EXECUTABLE'];
const PASSWORD = 'cavalo bateria grampo correto 42';
// Chave falsa, montada por partes (nenhum padrão de token inteiro no código-fonte).
const FAKE_KEY = ['sk-', 'ant-', 'api03-', 'Hq3Lz8Wv2Rt6Kp1Zm9Nd4Js7Bf0Gy5Ce', 'e2eConversa'].join('');

interface Script {
  readonly chunks: readonly string[];
  readonly delayMs?: number;
  /** Depois dos pedaços, segura a resposta aberta até o cliente desistir. */
  readonly hold?: boolean;
}

let app: RunningApp;
let page: Page;
let userData: string;
let pki: TestPki;
let server: TestServer;
const scripts: Script[] = [];
let abandoned = 0;

function hooks<T>(expression: string): Promise<T> {
  return app.mainEval<T>(`(() => { const h = globalThis.__jesusTest; return ${expression}; })()`);
}

const input = () => page.locator('#chat-input');
const notice = () => page.locator('.chat-notice');
const exchanges = () => page.locator('.chat-log .chat-exchange');
const lastAnswer = () => page.locator('.chat-log .chat-assistant .chat-text').last();

async function ask(question: string): Promise<void> {
  await input().fill(question);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

reportFailures(() => app);

beforeAll(async () => {
  const entry = executable !== undefined && executable !== '' ? executable : mainEntry;
  if (!existsSync(entry)) throw new Error(`Falta ${entry}. Rode: npm run build:test -w @jesus/desktop`);
  pki = createTestPki();
  server = await startTlsServer(pki, (_req, res) => {
    const script = scripts.shift();
    if (script === undefined) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'sem roteiro' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_e2e' });
    res.on('close', () => {
      if (!res.writableFinished) abandoned += 1;
    });
    let index = 0;
    const next = () => {
      if (res.destroyed) return;
      const chunk = script.chunks[index++];
      if (chunk === undefined) {
        if (script.hold !== true) res.end();
        return;
      }
      res.write(chunk);
      setTimeout(next, script.delayMs ?? 0);
    };
    next();
  });
  userData = await mkdtemp(join(tmpdir(), 'jesus-e2e-chat-'));
  app = await launchApp({ mainEntry, userData, executable });
  page = app.page;
  await page.waitForURL(`${APP}/entrar/`);
  const fields = page.locator('input[autocomplete="new-password"]');
  await fields.nth(0).fill(PASSWORD);
  await fields.nth(1).fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.getByRole('heading', { name: 'Anote o código de recuperação' }).waitFor({ timeout: 30_000 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.waitForURL(`${APP}/`);
  // O Cérebro pronto (o `expect.poll` só vale dentro de um teste).
  for (let waited = 0; !(await hooks<boolean>("h.brainEvents.some((e) => e.type === 'ready')")); waited += 200) {
    if (waited > 30_000) throw new Error('o Cérebro não ficou pronto');
    await page.waitForTimeout(200);
  }
});

afterAll(async () => {
  await app?.close();
  await server?.close();
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe('conversa na tela', () => {
  it('sem chave guardada: a tela manda guardar a chave, a pergunta volta para o campo e nada sai para a rede', async () => {
    await page.reload();
    await input().waitFor();
    await expect.poll(() => page.locator('.chat-empty').first().textContent()).toContain('só conversa');
    await ask('Oi');
    // Windows (DPAPI) ou Linux com chaveiro: não há chave guardada. Linux sem chaveiro (contêiner, CI): o cofre nem abre.
    const vaultProblem = await hooks<string | null>('h.vaultProblem()');
    await expect
      .poll(() => notice().textContent())
      .toBe(
        vaultProblem === null
          ? 'Falta a chave da API da Anthropic. Guarde a chave em Configurações.'
          : 'Não deu para ler a chave no cofre. Guarde a chave de novo em Configurações.',
      );
    expect(await input().inputValue()).toBe('Oi');
    expect(await exchanges().count()).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it('a resposta chega em pedaços e entra na conversa; o pedido sai com a chave e só pelo principal', async () => {
    await hooks(`h.useTestApi(${String(server.port)}, ${JSON.stringify(pki.ca)}, ${JSON.stringify(FAKE_KEY)})`);
    scripts.push({ chunks: answerEvents(['Olá! ', 'Eu sou o Jesus, ', 'seu assistente.']), delayMs: 120 });
    await ask('Quem é você?');
    // No meio: a pergunta já aparece e a resposta vai chegando.
    await expect.poll(() => lastAnswer().textContent()).toMatch(/^(Pensando…|Olá!)/);
    await expect.poll(() => lastAnswer().textContent(), { timeout: 15_000 }).toBe('Olá! Eu sou o Jesus, seu assistente.');
    await expect.poll(() => page.getByRole('button', { name: 'Enviar' }).count()).toBe(1);
    expect(await exchanges().count()).toBe(1);
    expect(await page.locator('.chat-log .chat-user .chat-text').last().textContent()).toBe('Quem é você?');
    expect(await page.locator('.chat-usage').textContent()).toBe('Conversa: menos de 1% do limite');
    expect(await input().inputValue()).toBe('');

    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request?.url).toBe('/v1/messages');
    expect(request?.headers['x-api-key']).toBe(FAKE_KEY);
    const body = JSON.parse(request?.body ?? '{}') as { model: string; messages: { role: string; content: { text: string }[] }[] };
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.messages.at(-1)?.content[0]?.text).toBe('Quem é você?');

    // A conversa mora no Cérebro: recarregar a página mostra a mesma conversa.
    await page.reload();
    await expect.poll(() => exchanges().count()).toBe(1);
    expect(await lastAnswer().textContent()).toBe('Olá! Eu sou o Jesus, seu assistente.');
  });

  it('Parar: a resposta para no meio, o pedido à API é interrompido e a pergunta volta para o campo', async () => {
    scripts.push({ chunks: [messageStart(), ...textBlock(0, ['Era uma vez']).slice(0, 2)], hold: true });
    const before = abandoned;
    await ask('Conta uma história');
    await expect.poll(() => lastAnswer().textContent(), { timeout: 15_000 }).toBe('Era uma vez');
    await page.getByRole('button', { name: 'Parar' }).click();
    await expect.poll(() => notice().textContent()).toBe('Resposta parada.');
    expect(await input().inputValue()).toBe('Conta uma história');
    expect(await exchanges().count()).toBe(1);
    await expect.poll(() => abandoned).toBe(before + 1);
    // O que o pedido parado reservou volta ao teto (fica só o que a API pode ter cobrado).
    await expect.poll(async () => (await hooks<{ reservedPUsd: number }>('h.spend()')).reservedPUsd).toBe(0);
  });

  it('a segunda pergunta leva a primeira troca no histórico, só como texto', async () => {
    scripts.push({ chunks: answerEvents(['Tudo certo por aqui.']) });
    await input().fill('');
    await ask('Tudo bem?');
    await expect.poll(() => lastAnswer().textContent(), { timeout: 15_000 }).toBe('Tudo certo por aqui.');
    const body = JSON.parse(server.requests.at(-1)?.body ?? '{}') as { messages: { role: string; content: { type: string; text?: string }[] }[] };
    expect(body.messages.map((message) => [message.role, message.content.map((part) => part.text).join('')])).toEqual([
      ['user', 'Quem é você?'],
      ['assistant', 'Olá! Eu sou o Jesus, seu assistente.'],
      ['user', 'Tudo bem?'],
    ]);
    expect(await exchanges().count()).toBe(2);
  });

  it('Nova conversa: a tela começa vazia, e o Cérebro também', async () => {
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await expect.poll(() => exchanges().count()).toBe(0);
    await page.reload();
    await input().waitFor();
    expect(await exchanges().count()).toBe(0);
  });

  it('bloquear no meio de uma resposta para o turno; ao voltar, ele não entrou na conversa', async () => {
    scripts.push({ chunks: [messageStart(), ...textBlock(0, ['Um segredo']).slice(0, 2)], hold: true });
    const before = abandoned;
    await ask('Me conta algo');
    await expect.poll(() => lastAnswer().textContent(), { timeout: 15_000 }).toBe('Um segredo');
    await page.getByRole('button', { name: 'Bloquear' }).click();
    await page.waitForURL(`${APP}/entrar/`);
    await expect.poll(() => abandoned, { timeout: 10_000 }).toBe(before + 1);
    await page.getByRole('heading', { name: 'Desbloquear o Jesus' }).waitFor();
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await page.waitForURL(`${APP}/`);
    await input().waitFor();
    expect(await exchanges().count()).toBe(0);
  });

  it('a chave falsa não aparece na tela, na saída do app nem nos arquivos; o registro tem os pedidos', async () => {
    expect(await page.content()).not.toContain(FAKE_KEY);
    expect(app.output.join('')).not.toContain(FAKE_KEY);
    for (const name of await readdir(join(userData, 'data'))) {
      const content = await readFile(join(userData, 'data', name), 'utf8').catch(() => '');
      expect(content, name).not.toContain(FAKE_KEY);
    }
    const events = (await readFile(join(userData, 'data', 'audit.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { event: { type: string } }).event.type);
    expect(events.filter((type) => type === 'api.call').length).toBeGreaterThanOrEqual(4);
  });

  it('nenhuma violação de CSP na tela de conversa', async () => {
    const lines = await hooks<string[]>('h.consoleMessages');
    expect(lines.filter((line) => /Content Security Policy|Refused to/i.test(line))).toEqual([]);
  });
});
