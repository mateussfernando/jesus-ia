'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { getAuthRuntime, readAccess } from '../../../server/auth-runtime';
import { desktopBridge } from '../../../server/desktop-bridge';
import { SESSION_COOKIE } from '../../../server/session';
import { messageFor, NO_VAULT } from '../../../settings/key-messages';
import type { KeySettingsState } from '../../../settings/key-messages';
import { formatUsd, NO_SPEND, parseDailyLimit, spendMessageFor } from '../../../settings/spend-messages';
import type { SpendSettingsState } from '../../../settings/spend-messages';

/**
 * Back-end da tela Configurações (decisões 0020 e 0023). A chave da API vem da página e vai direto ao cofre do processo
 * principal pela ponte: aqui ela só passa (não fica em variável global, arquivo nem registro), e nunca volta para a
 * página. Quem confere a forma, recusa a chave de administrador e registra a tentativa é o principal. O teto de gasto
 * do dia também é do principal: aqui ele é lido e conferido só para a mensagem sair clara.
 */

const keyInput = z.string().min(1).max(512);

const LOCKED: KeySettingsState = { anthropicKey: 'unknown', ok: false, message: 'O Jesus está bloqueado.' };

async function unlocked(): Promise<boolean> {
  const runtime = await getAuthRuntime();
  return readAccess(runtime, (await cookies()).get(SESSION_COOKIE)?.value, false);
}

export async function saveAnthropicKey(key: unknown): Promise<KeySettingsState> {
  if (!(await unlocked())) return LOCKED;
  const bridge = desktopBridge();
  if (bridge === null) return NO_VAULT;
  const parsed = keyInput.safeParse(key);
  if (!parsed.success) return messageFor({ ok: false, anthropicKey: (await bridge.vault.status()).anthropicKey, problem: 'format' }, '');
  return messageFor(await bridge.vault.setAnthropicKey(parsed.data), 'Chave guardada no cofre.');
}

const LIMIT_LOCKED: SpendSettingsState = { available: true, summary: null, limitInput: '', ok: false, message: 'O Jesus está bloqueado.' };

export async function saveDailyLimit(value: unknown): Promise<SpendSettingsState> {
  if (!(await unlocked())) return LIMIT_LOCKED;
  const bridge = desktopBridge();
  if (bridge === null) return NO_SPEND;
  const parsed = typeof value === 'string' && value.length <= 32 ? parseDailyLimit(value) : ({ ok: false } as const);
  if (!parsed.ok) return spendMessageFor({ ...(await bridge.spend.status()), ok: false, problem: 'range' }, null);
  return spendMessageFor(await bridge.spend.setDailyLimit(parsed.pUsd), `Teto do dia: ${formatUsd(parsed.pUsd)}.`);
}

export async function removeAnthropicKey(): Promise<KeySettingsState> {
  if (!(await unlocked())) return LOCKED;
  const bridge = desktopBridge();
  if (bridge === null) return NO_VAULT;
  return messageFor(await bridge.vault.clearAnthropicKey(), 'Chave apagada do cofre.');
}
