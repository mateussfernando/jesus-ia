import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthRuntime, readAccess } from './auth-runtime';
import { SESSION_COOKIE } from './session';

/**
 * Toda página protegida chama isto no começo (não basta o layout: no App Router, o layout não roda de novo a cada
 * navegação). Bloqueado ou sem sessão → tela de entrada. Abrir uma página conta como uso só fora do app de desktop:
 * no app, o uso vem do processo principal (decisão 0019), e uma página comprometida que se recarregasse sem parar não
 * pode impedir o bloqueio por tempo sem uso.
 */
export async function requireUnlocked(): Promise<void> {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!readAccess(runtime, token, !runtime.activityFromHost)) redirect('/entrar/');
}
