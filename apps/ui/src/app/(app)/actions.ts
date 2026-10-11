'use server';

import { cookies } from 'next/headers';
import { getAuthRuntime, lockRuntime, readAccess } from '../../server/auth-runtime';
import { SESSION_COOKIE } from '../../server/session';

/** Bloqueia o Jesus agora (botão "Bloquear"). Sempre permitido: bloquear é seguro. */
export async function lockNow(): Promise<void> {
  const runtime = await getAuthRuntime();
  lockRuntime(runtime);
  (await cookies()).delete(SESSION_COOKIE);
}

/** Sinal de uso da página aberta: adia o bloqueio por tempo sem uso e diz se a sessão ainda vale. */
export async function touch(): Promise<{ unlocked: boolean }> {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return { unlocked: readAccess(runtime, token, true) };
}
