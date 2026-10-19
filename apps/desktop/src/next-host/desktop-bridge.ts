import type { HostLockReason, SpendReply, VaultReply } from '../bridge/protocol';

/**
 * Ponte do servidor da interface com o processo principal, vista pelo código do `apps/ui` (decisão 0019): um objeto
 * congelado num símbolo global, só de leitura. Por ela chegam os bloqueios do Windows (sessão bloqueada, suspensão) e
 * o uso de verdade na janela, que só o principal vê (a página não consegue fingir uma tecla do sistema).
 */
export const DESKTOP_BRIDGE_KEY = Symbol.for('jesus.desktop.bridge');

/** Resposta do cofre, sem a mensagem de transporte. A chave nunca volta, só se ela está guardada. */
export type VaultResult = Omit<VaultReply, 'type' | 'id'>;

export interface DesktopVault {
  status(): Promise<VaultResult>;
  /** A chave vai ao principal, que confere a forma e guarda cifrada; aqui ela só passa. */
  setAnthropicKey(key: string): Promise<VaultResult>;
  clearAnthropicKey(): Promise<VaultResult>;
}

/** Resposta do teto de gasto do dia (decisão 0023), sem a mensagem de transporte. */
export type SpendResult = Omit<SpendReply, 'type' | 'id'>;

export interface DesktopSpend {
  status(): Promise<SpendResult>;
  /** O principal confere a faixa, grava a mudança no registro e só então aplica. */
  setDailyLimit(limitPUsd: number): Promise<SpendResult>;
}

export interface DesktopBridge {
  /** Tempo sem uso (ms) mandado pelo principal; `undefined` vale o padrão. Só o build de teste manda. */
  readonly idleMs: number | undefined;
  /** Cofre do principal (decisão 0020). */
  readonly vault: DesktopVault;
  /** Teto de gasto do dia, guardado e aplicado pelo principal (decisão 0023). */
  readonly spend: DesktopSpend;
  /** Quem aplica os bloqueios do Windows no estado de acesso. Um só: um segundo registro lança. */
  onLock(listener: (reason: HostLockReason) => void): void;
  /** Quem conta o uso de verdade. Um só. */
  onActivity(listener: () => void): void;
}

/** Lado do servidor da interface: entrega à ponte o que chega do principal. */
export interface HostBridge {
  readonly bridge: DesktopBridge;
  /** Liga a ponte ao principal (o `parentPort`), para os pedidos ao cofre. */
  connect(post: (message: unknown) => void): void;
  /** Resposta do principal a um pedido ao cofre. */
  vaultReply(reply: VaultReply): void;
  /** Resposta do principal a um pedido sobre o teto do dia. */
  spendReply(reply: SpendReply): void;
  configure(idleMs: number | undefined): void;
  /**
   * Aplica um bloqueio e diz se deu certo. Sem ninguém registrado também dá: o estado de acesso ainda não existe e,
   * quando existir, começa bloqueado. Se quem aplica lança, não deu (e o principal reinicia o servidor).
   */
  lock(reason: HostLockReason): boolean;
  activity(): void;
}

/** Sem resposta do principal nesse tempo, o pedido ao cofre (ou ao teto do dia) falha. */
export const VAULT_TIMEOUT_MS = 10_000;

export function createHostBridge(options: { vaultTimeoutMs?: number } = {}): HostBridge {
  let idleMs: number | undefined;
  let lockListener: ((reason: HostLockReason) => void) | null = null;
  let activityListener: (() => void) | null = null;
  let post: ((message: unknown) => void) | null = null;
  let nextId = 1;
  // Cada pedido espera a resposta do mesmo tipo (cofre ou teto); uma resposta de outro tipo com o mesmo id é ignorada.
  const pending = new Map<number, { readonly type: 'vault-reply' | 'spend-reply'; readonly settle: (reply: VaultReply | SpendReply) => void }>();
  const failedVault: VaultResult = { ok: false, anthropicKey: 'unknown', problem: 'failed' };
  const failedSpend: SpendResult = { ok: false, problem: 'failed' };
  function ask<R>(message: Record<string, unknown>, replyType: 'vault-reply' | 'spend-reply', failed: R, read: (reply: never) => R): Promise<R> {
    return new Promise((resolve) => {
      if (post === null) {
        resolve(failed);
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(failed);
      }, options.vaultTimeoutMs ?? VAULT_TIMEOUT_MS);
      pending.set(id, {
        type: replyType,
        settle: (reply) => {
          clearTimeout(timer);
          resolve(read(reply as never));
        },
      });
      try {
        post({ ...message, id });
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        resolve(failed);
      }
    });
  }
  const readVault = (reply: VaultReply): VaultResult => ({
    ok: reply.ok,
    anthropicKey: reply.anthropicKey,
    ...(reply.problem === undefined ? {} : { problem: reply.problem }),
  });
  const readSpend = (reply: SpendReply): SpendResult => ({
    ok: reply.ok,
    ...(reply.day === undefined ? {} : { day: reply.day }),
    ...(reply.problem === undefined ? {} : { problem: reply.problem }),
  });
  const request = (op: 'status' | 'set-anthropic-key' | 'clear-anthropic-key', key?: string): Promise<VaultResult> =>
    ask({ type: 'vault', op, ...(key === undefined ? {} : { key }) }, 'vault-reply', failedVault, readVault);
  const vault: DesktopVault = Object.freeze({
    status: () => request('status'),
    setAnthropicKey: (key: string) => request('set-anthropic-key', key),
    clearAnthropicKey: () => request('clear-anthropic-key'),
  });
  const spend: DesktopSpend = Object.freeze({
    status: () => ask({ type: 'spend', op: 'status' }, 'spend-reply', failedSpend, readSpend),
    setDailyLimit: (limitPUsd: number) =>
      ask({ type: 'spend', op: 'set-limit', limitPUsd }, 'spend-reply', failedSpend, readSpend),
  });
  const settle = (reply: VaultReply | SpendReply) => {
    const entry = pending.get(reply.id);
    if (entry?.type !== reply.type) return;
    pending.delete(reply.id);
    entry.settle(reply);
  };
  const bridge: DesktopBridge = Object.freeze({
    get idleMs() {
      return idleMs;
    },
    vault,
    spend,
    onLock(listener: (reason: HostLockReason) => void) {
      if (lockListener !== null) throw new Error('o bloqueio já tem quem aplique');
      lockListener = listener;
    },
    onActivity(listener: () => void) {
      if (activityListener !== null) throw new Error('o uso já tem quem conte');
      activityListener = listener;
    },
  });
  return {
    bridge,
    connect(sender) {
      post = sender;
    },
    vaultReply: settle,
    spendReply: settle,
    configure(value) {
      idleMs = value;
    },
    lock(reason) {
      if (lockListener === null) return true;
      try {
        lockListener(reason);
        return true;
      } catch {
        return false;
      }
    },
    activity() {
      try {
        activityListener?.();
      } catch {
        // O próximo sinal de uso tenta de novo; o bloqueio por tempo sem uso erra para o lado de bloquear.
      }
    },
  };
}

/** Põe a ponte no símbolo global, sem como trocar nem apagar (só na entrada do utilityProcess). */
export function installDesktopBridge(bridge: DesktopBridge): void {
  Object.defineProperty(globalThis, DESKTOP_BRIDGE_KEY, { value: bridge, writable: false, enumerable: false, configurable: false });
}
