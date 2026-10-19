import type { HostLockReason } from '../bridge/protocol';

/**
 * Ponte do servidor da interface com o processo principal, vista pelo código do `apps/ui` (decisão 0019): um objeto
 * congelado num símbolo global, só de leitura. Por ela chegam os bloqueios do Windows (sessão bloqueada, suspensão) e
 * o uso de verdade na janela, que só o principal vê (a página não consegue fingir uma tecla do sistema).
 */
export const DESKTOP_BRIDGE_KEY = Symbol.for('jesus.desktop.bridge');

export interface DesktopBridge {
  /** Tempo sem uso (ms) mandado pelo principal; `undefined` vale o padrão. Só o build de teste manda. */
  readonly idleMs: number | undefined;
  /** Quem aplica os bloqueios do Windows no estado de acesso. Um só: um segundo registro lança. */
  onLock(listener: (reason: HostLockReason) => void): void;
  /** Quem conta o uso de verdade. Um só. */
  onActivity(listener: () => void): void;
}

/** Lado do servidor da interface: entrega à ponte o que chega do principal. */
export interface HostBridge {
  readonly bridge: DesktopBridge;
  configure(idleMs: number | undefined): void;
  /**
   * Aplica um bloqueio e diz se deu certo. Sem ninguém registrado também dá: o estado de acesso ainda não existe e,
   * quando existir, começa bloqueado. Se quem aplica lança, não deu (e o principal reinicia o servidor).
   */
  lock(reason: HostLockReason): boolean;
  activity(): void;
}

export function createHostBridge(): HostBridge {
  let idleMs: number | undefined;
  let lockListener: ((reason: HostLockReason) => void) | null = null;
  let activityListener: (() => void) | null = null;
  const bridge: DesktopBridge = Object.freeze({
    get idleMs() {
      return idleMs;
    },
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
