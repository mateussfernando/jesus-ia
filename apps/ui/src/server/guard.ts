import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthRuntime, readAccess } from './auth-runtime';
import { SESSION_COOKIE } from './session';

/**
 * Toda página protegida chama isto no começo (não basta o layout: no App Router, o layout não roda de novo a cada
 * navegação). Bloqueado ou sem sessão → tela de entrada.
 */
export async function requireUnlocked(): Promise<void> {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!readAccess(runtime, token, true)) redirect('/entrar/');
}
