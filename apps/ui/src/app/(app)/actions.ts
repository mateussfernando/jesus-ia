'use server';

import { cookies } from 'next/headers';
import { getAuthRuntime, lockRuntime, readAccess } from '../../server/auth-runtime';
import { SESSION_COOKIE } from '../../server/session';

/**
 * Bloqueia o Jesus agora (botão "Bloquear"). Como toda Server Action, confere a sessão: só quem está com o app
 * aberto bloqueia o app. Sem sessão válida, apaga só o cookie de quem chamou (que já não valia). Os bloqueios que
 * não vêm da página (Windows, suspensão) chegam pela ponte do processo principal (`server/desktop-bridge.ts`).
 */
export async function lockNow(): Promise<void> {
  const runtime = await getAuthRuntime();
  const store = await cookies();
  if (readAccess(runtime, store.get(SESSION_COOKIE)?.value, false)) lockRuntime(runtime);
  store.delete(SESSION_COOKIE);
}

/** Confere se a sessão ainda vale, sem contar como uso (a conferência periódica da página aberta). */
export async function checkSession(): Promise<{ unlocked: boolean }> {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return { unlocked: readAccess(runtime, token, false) };
}

/**
 * Sinal de uso de verdade (tecla, clique ou rolagem): adia o bloqueio por tempo sem uso e diz se a sessão vale. No app
 * de desktop, o uso vem do processo principal (que vê a entrada do sistema), e este sinal só confere a sessão: uma
 * página comprometida poderia chamá-lo sem parar para o Jesus nunca bloquear sozinho.
 */
export async function touch(): Promise<{ unlocked: boolean }> {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return { unlocked: readAccess(runtime, token, !runtime.activityFromHost) };
}
