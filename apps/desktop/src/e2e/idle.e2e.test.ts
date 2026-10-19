import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP, launchApp } from './harness';
import type { RunningApp } from './harness';

/**
 * Bloqueio por tempo sem uso no app de verdade (decisão 0019), com o prazo curto que só o build de teste aceita. O uso
 * que conta é a entrada que o sistema entrega à janela, vista pelo processo principal; um evento criado por script na
 * página não adia nada.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainEntry = join(desktopDir, 'dist-test', 'main.mjs');
const executable = process.env['JESUS_E2E_EXECUTABLE'];
const PASSWORD = 'cavalo bateria grampo correto 42';
const IDLE_MS = 4_000;

let app: RunningApp;
let userData: string;

beforeAll(async () => {
  const entry = executable !== undefined && executable !== '' ? executable : mainEntry;
  if (!existsSync(entry)) throw new Error(`Falta ${entry}. Rode: npm run build:test -w @jesus/desktop`);
  userData = await mkdtemp(join(tmpdir(), 'jesus-e2e-idle-'));
  app = await launchApp({ mainEntry, userData, executable, idleMs: IDLE_MS });
});

afterAll(async () => {
  await app?.close();
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe('bloqueio por tempo sem uso', () => {
  it('a entrada de verdade mantém o Jesus aberto; evento criado pela página não adia o bloqueio', async () => {
    const { page } = app;
    await page.waitForURL(`${APP}/entrar/`);
    const fields = page.locator('input[autocomplete="new-password"]');
    await fields.nth(0).fill(PASSWORD);
    await fields.nth(1).fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.getByRole('heading', { name: 'Anote o código de recuperação' }).waitFor({ timeout: 30_000 });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.waitForURL(`${APP}/`);

    // Teclas de verdade (pelo sistema de entrada do Chromium) por mais que o dobro do prazo: continua aberto.
    for (let elapsed = 0; elapsed < 2.5 * IDLE_MS; elapsed += 500) {
      await page.keyboard.press('Shift');
      await page.waitForTimeout(500);
    }
    expect(page.url()).toBe(`${APP}/`);
    expect(await page.evaluate(async () => (await fetch('/')).url)).toBe(`${APP}/`);

    // Só eventos criados por script: a página avisa o servidor, mas no app esse aviso não conta como uso.
    const synthetic = setInterval(() => {
      void page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))).catch(() => undefined);
    }, 300);
    try {
      await page.waitForURL(`${APP}/entrar/`, { timeout: 20_000 });
    } finally {
      clearInterval(synthetic);
    }
  });
});
