'use server';

import { cookies } from 'next/headers';
import { getAuthRuntime, readAccess } from '../../server/auth-runtime';
import { desktopBridge } from '../../server/desktop-bridge';
import type { ChatResult } from '../../server/desktop-bridge';
import { SESSION_COOKIE } from '../../server/session';

/**
 * Back-end da tela de conversa (decisões 0024 e 0025), além da rota do turno (`/api/conversa/`). A conversa mora no
 * Cérebro; aqui só se pede pela ponte. Como toda Server Action, cada uma confere a sessão sozinha, sem contar como uso
 * (a tela confere o estado de tempos em tempos enquanto um turno de antes termina).
 */

const LOCKED: ChatResult = { ok: false, reason: 'locked' };
const UNAVAILABLE: ChatResult = { ok: false, reason: 'unavailable' };

async function unlocked(): Promise<boolean> {
  const runtime = await getAuthRuntime();
  return readAccess(runtime, (await cookies()).get(SESSION_COOKIE)?.value, false);
}

/** A conversa como está no Cérebro. */
export async function chatState(): Promise<ChatResult> {
  if (!(await unlocked())) return LOCKED;
  const bridge = desktopBridge();
  return bridge === null ? UNAVAILABLE : bridge.chat.state();
}

/** Começa uma conversa nova (o Cérebro esquece a anterior e para o turno em andamento). */
export async function newChat(): Promise<ChatResult> {
  if (!(await unlocked())) return LOCKED;
  const bridge = desktopBridge();
  return bridge === null ? UNAVAILABLE : bridge.chat.reset();
}

/** O botão Parar: para o turno em andamento (ele termina com `cancelled` na rota do turno). */
export async function stopChat(): Promise<{ readonly ok: boolean }> {
  if (!(await unlocked())) return { ok: false };
  const bridge = desktopBridge();
  if (bridge === null) return { ok: false };
  bridge.chat.stop();
  return { ok: true };
}
