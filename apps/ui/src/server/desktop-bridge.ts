import type { ChatFailure } from '@jesus/core/chat';

/**
 * Ponte do app de desktop (decisão 0019): quando o servidor da interface roda dentro do Jesus (utilityProcess
 * `jesus-next`), o processo principal entrega por ela os bloqueios do Windows (sessão bloqueada, suspensão), o uso de
 * verdade na janela, o cofre (decisão 0020), o teto de gasto do dia (decisão 0023), a conversa com o Cérebro (decisão
 * 0024) e, só no build de teste, o tempo sem uso. No `next dev` ela não existe.
 */

export type HostLockReason = 'os_locked' | 'suspend';

/** Resposta do cofre do processo principal (decisão 0020): só se há chave guardada, nunca a chave. */
export interface VaultResult {
  readonly ok: boolean;
  readonly anthropicKey: 'absent' | 'present' | 'unknown';
  readonly problem?: 'unavailable' | 'insecure_backend' | 'admin' | 'format' | 'failed';
}

export interface DesktopVault {
  status(): Promise<VaultResult>;
  setAnthropicKey(key: string): Promise<VaultResult>;
  clearAnthropicKey(): Promise<VaultResult>;
}

/** Gasto do dia como o processo principal vê (decisão 0023), em picodólares (US$ 1 = 10¹² pUSD). */
export interface SpendDay {
  readonly dayKey: string;
  readonly spentPUsd: number;
  readonly reservedPUsd: number;
  readonly limitPUsd: number;
}

export interface SpendResult {
  readonly ok: boolean;
  /** Ausente quando o principal não respondeu. */
  readonly day?: SpendDay;
  readonly problem?: 'range' | 'audit' | 'failed';
}

/** Teto de gasto do dia, guardado e aplicado pelo principal. */
export interface DesktopSpend {
  status(): Promise<SpendResult>;
  setDailyLimit(limitPUsd: number): Promise<SpendResult>;
}

/** Uma troca da conversa, como o Cérebro guarda (a pergunta já mascarada). */
export interface ChatTurn {
  readonly user: string;
  readonly assistant: string;
}

/** A conversa (decisão 0024): só as trocas que terminaram, o que ela ocupa do limite e se há um turno em andamento. */
export interface ChatState {
  readonly conversationId: string;
  readonly turns: readonly ChatTurn[];
  readonly contextTokens: number;
  readonly limitTokens: number;
  readonly busy: boolean;
}

/** Fim de um turno: `length` quer dizer que a resposta foi cortada na saída máxima. */
export interface ChatDone {
  readonly conversationId: string;
  readonly finish: 'stop' | 'length';
  readonly contextTokens: number;
  readonly limitTokens: number;
}

export type ChatResult = { readonly ok: true; readonly state: ChatState } | { readonly ok: false; readonly reason: ChatFailure };

/** O que chega de um turno: pedaços da resposta e, no fim, sempre `done` ou `error`. */
export type ChatTurnEvent =
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'done'; readonly done: ChatDone }
  | { readonly kind: 'error'; readonly reason: ChatFailure };

/** A conversa, que mora no Cérebro; o principal só repassa. */
export interface DesktopChat {
  state(): Promise<ChatResult>;
  /** Começa uma conversa nova (o turno em andamento para). */
  reset(): Promise<ChatResult>;
  /** Pergunta na conversa `conversationId`. A função devolvida para o turno. */
  send(conversationId: string, text: string, listener: (event: ChatTurnEvent) => void): () => void;
  /** Para os turnos que este servidor começou (o botão Parar). */
  stop(): void;
}

export interface DesktopBridge {
  readonly idleMs: number | undefined;
  readonly vault: DesktopVault;
  readonly spend: DesktopSpend;
  readonly chat: DesktopChat;
  onLock(listener: (reason: HostLockReason) => void): void;
  onActivity(listener: () => void): void;
}

const BRIDGE_KEY = Symbol.for('jesus.desktop.bridge');

export function desktopBridge(): DesktopBridge | null {
  const value: unknown = Reflect.get(globalThis, BRIDGE_KEY);
  if (value === null || typeof value !== 'object') return null;
  const onLock: unknown = Reflect.get(value, 'onLock');
  const onActivity: unknown = Reflect.get(value, 'onActivity');
  if (typeof onLock !== 'function' || typeof onActivity !== 'function') return null;
  const vault: unknown = Reflect.get(value, 'vault');
  if (vault === null || typeof vault !== 'object') return null;
  for (const method of ['status', 'setAnthropicKey', 'clearAnthropicKey']) {
    if (typeof Reflect.get(vault, method) !== 'function') return null;
  }
  const spend: unknown = Reflect.get(value, 'spend');
  if (spend === null || typeof spend !== 'object') return null;
  for (const method of ['status', 'setDailyLimit']) {
    if (typeof Reflect.get(spend, method) !== 'function') return null;
  }
  const chat: unknown = Reflect.get(value, 'chat');
  if (chat === null || typeof chat !== 'object') return null;
  for (const method of ['state', 'reset', 'send', 'stop']) {
    if (typeof Reflect.get(chat, method) !== 'function') return null;
  }
  const idleMs: unknown = Reflect.get(value, 'idleMs');
  if (idleMs !== undefined && (typeof idleMs !== 'number' || !Number.isSafeInteger(idleMs) || idleMs < 1_000)) return null;
  return value as DesktopBridge;
}
