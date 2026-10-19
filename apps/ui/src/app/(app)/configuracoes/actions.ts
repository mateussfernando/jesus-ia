'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { getAuthRuntime, readAccess } from '../../../server/auth-runtime';
import { desktopBridge } from '../../../server/desktop-bridge';
import { SESSION_COOKIE } from '../../../server/session';
import { messageFor, NO_VAULT } from '../../../settings/key-messages';
import type { KeySettingsState } from '../../../settings/key-messages';

/**
 * Back-end da tela Configurações (decisão 0020). A chave da API vem da página e vai direto ao cofre do processo
 * principal pela ponte: aqui ela só passa (não fica em variável global, arquivo nem registro), e nunca volta para a
 * página. Quem confere a forma, recusa a chave de administrador e registra a tentativa é o principal.
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

export async function removeAnthropicKey(): Promise<KeySettingsState> {
  if (!(await unlocked())) return LOCKED;
  const bridge = desktopBridge();
  if (bridge === null) return NO_VAULT;
  return messageFor(await bridge.vault.clearAnthropicKey(), 'Chave apagada do cofre.');
}
