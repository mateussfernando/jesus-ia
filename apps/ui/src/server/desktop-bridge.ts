/**
 * Ponte do app de desktop (decisão 0019): quando o servidor da interface roda dentro do Jesus (utilityProcess
 * `jesus-next`), o processo principal entrega por ela os bloqueios do Windows (sessão bloqueada, suspensão), o uso de
 * verdade na janela e, só no build de teste, o tempo sem uso. No `next dev` ela não existe.
 */

export type HostLockReason = 'os_locked' | 'suspend';

export interface DesktopBridge {
  readonly idleMs: number | undefined;
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
  const idleMs: unknown = Reflect.get(value, 'idleMs');
  if (idleMs !== undefined && (typeof idleMs !== 'number' || !Number.isSafeInteger(idleMs) || idleMs < 1_000)) return null;
  return value as DesktopBridge;
}
