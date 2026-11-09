import { cookies } from 'next/headers';
import { handleTurnRequest } from '../../../chat/turn-route';
import { getAuthRuntime, readAccess } from '../../../server/auth-runtime';
import { desktopBridge } from '../../../server/desktop-bridge';
import { SESSION_COOKIE } from '../../../server/session';

/** Um turno da conversa: a pergunta vai ao Cérebro, e a resposta volta em pedaços (`chat/turn-route.ts`, decisão 0025). */
export async function POST(request: Request): Promise<Response> {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return handleTurnRequest(request, {
    unlocked: (activity) => readAccess(runtime, token, activity && !runtime.activityFromHost),
    chat: desktopBridge()?.chat ?? null,
  });
}
