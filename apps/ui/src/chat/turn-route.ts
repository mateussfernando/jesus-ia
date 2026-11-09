import { MAX_CHAT_TEXT_CHARS } from '@jesus/core/chat';
import { z } from 'zod';
import type { DesktopChat } from '../server/desktop-bridge';
import { isJsonRequest, isSameOriginRequest } from '../server/same-origin';
import { encodeTurnEvent } from './stream';
import type { TurnEvent } from './stream';

/**
 * Rota de um turno da conversa (`POST /api/conversa/`; decisão 0025). A tela manda a pergunta e recebe a resposta em
 * pedaços, uma linha JSON por evento, à medida que chegam do Cérebro (pelo principal). O turno só segue enquanto a
 * sessão vale: bloqueou (botão, tempo sem uso, Windows), o turno para na hora e a tela recebe `locked`. A tela ir
 * embora (navegar, fechar) também para o turno.
 */

/** Maior corpo aceito (caracteres): a pergunta tem até 20 mil, e o escape do JSON pode multiplicar por seis. */
export const MAX_TURN_BODY_CHARS = 128 * 1024;
/** De quanto em quanto tempo o turno confere se a sessão ainda vale, enquanto espera o modelo. */
export const LOCK_CHECK_MS = 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TurnRequestSchema = z.strictObject({
  conversationId: z.string().regex(UUID),
  text: z.string().min(1).max(MAX_CHAT_TEXT_CHARS),
});

const NDJSON_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  // Sem cache e sem compressão no caminho (a compressão seguraria os pedaços até juntar bastante).
  'Cache-Control': 'no-store, no-transform',
};

export interface TurnRouteDeps {
  /** A sessão do pedido ainda vale; com `activity`, conta como uso (fora do app de desktop). */
  readonly unlocked: (activity: boolean) => boolean;
  /** A conversa pela ponte do app de desktop; `null` fora dele. */
  readonly chat: DesktopChat | null;
  readonly lockCheckMs?: number;
}

function single(status: number, event: TurnEvent): Response {
  return new Response(encodeTurnEvent(event), { status, headers: NDJSON_HEADERS });
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > MAX_TURN_BODY_CHARS * 4) return undefined;
  const raw = await request.text();
  if (raw.length > MAX_TURN_BODY_CHARS) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function handleTurnRequest(request: Request, deps: TurnRouteDeps): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) return new Response(null, { status: 403 });
  if (!isJsonRequest(request.headers)) return new Response(null, { status: 415 });
  // Mandar uma pergunta é uso (no app de desktop, o uso vem do principal e isto só confere a sessão).
  if (!deps.unlocked(true)) return single(401, { kind: 'error', reason: 'locked' });
  const parsed = TurnRequestSchema.safeParse(await readBody(request));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { chat } = deps;
  if (chat === null) return single(200, { kind: 'error', reason: 'unavailable' });
  const { conversationId, text } = parsed.data;

  const encoder = new TextEncoder();
  let finished = false;
  let stopTurn: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const end = () => {
        finished = true;
        clearInterval(timer);
        controller.close();
      };
      const push = (event: TurnEvent) => controller.enqueue(encoder.encode(encodeTurnEvent(event)));
      /** Bloqueou: para o turno, avisa a tela e fecha. */
      const lockedNow = () => {
        if (finished || deps.unlocked(false)) return false;
        stopTurn?.();
        push({ kind: 'error', reason: 'locked' });
        end();
        return true;
      };
      stopTurn = chat.send(conversationId, text, (event) => {
        if (finished || lockedNow()) return;
        push(event);
        if (event.kind !== 'delta') end();
      });
      if (!finished) timer = setInterval(lockedNow, deps.lockCheckMs ?? LOCK_CHECK_MS);
    },
    cancel() {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      stopTurn?.();
    },
  });
  return new Response(stream, { status: 200, headers: NDJSON_HEADERS });
}
