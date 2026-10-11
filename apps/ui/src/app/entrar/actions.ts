'use server';

import type { RecoveryResult, SetupResult, UnlockResult } from '@jesus/auth';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { beginSession, getAuthRuntime } from '../../server/auth-runtime';
import { SESSION_COOKIE, sessionCookieOptions } from '../../server/session';

/**
 * Back-end da tela de entrada (decisões 0015 e 0016): Server Actions, chamadas pela página como funções. Só
 * aceitam POST do próprio app (o Next confere a origem). Cada uma valida a entrada, chama o serviço de login e,
 * no acerto, abre a sessão (cookie HttpOnly). A senha nunca volta para a página; o hash nem sai do servidor.
 */

// Limites de tamanho antes de qualquer trabalho: o bcrypt lê no máximo 72 bytes, e o resto é só custo.
const passwordInput = z.string().max(1024);
const codeInput = z.string().max(64);

async function startSession(): Promise<void> {
  const runtime = await getAuthRuntime();
  const token = beginSession(runtime);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(runtime.secureCookies));
}

export async function setupPassword(password: unknown): Promise<SetupResult> {
  const parsed = passwordInput.safeParse(password);
  if (!parsed.success) return { ok: false, reason: 'weak_password', problems: ['too_long'] };
  const runtime = await getAuthRuntime();
  const result = await runtime.service.setup(parsed.data);
  if (result.ok) await startSession();
  return result;
}

export async function unlockWithPassword(password: unknown): Promise<UnlockResult> {
  const parsed = passwordInput.safeParse(password);
  // Entrada absurda conta como senha errada: o serviço registra o erro e aplica a espera.
  const runtime = await getAuthRuntime();
  const result = await runtime.service.unlock(parsed.success ? parsed.data : '');
  if (result.ok) await startSession();
  return result;
}

export async function recoverWithCode(code: unknown, password: unknown): Promise<RecoveryResult> {
  const parsedCode = codeInput.safeParse(code);
  const parsedPassword = passwordInput.safeParse(password);
  if (!parsedPassword.success) return { ok: false, reason: 'weak_password', problems: ['too_long'] };
  const runtime = await getAuthRuntime();
  const result = await runtime.service.recover(parsedCode.success ? parsedCode.data : '', parsedPassword.data);
  if (result.ok) await startSession();
  return result;
}
