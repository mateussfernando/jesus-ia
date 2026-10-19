/**
 * Ponte do app de desktop (decisão 0019): quando o servidor da interface roda dentro do Jesus (utilityProcess
 * `jesus-next`), o processo principal entrega por ela os bloqueios do Windows (sessão bloqueada, suspensão), o uso de
 * verdade na janela, o cofre (decisão 0020), o teto de gasto do dia (decisão 0023) e, só no build de teste, o tempo
 * sem uso. No `next dev` ela não existe.
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

export interface DesktopBridge {
  readonly idleMs: number | undefined;
  readonly vault: DesktopVault;
  readonly spend: DesktopSpend;
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
  const idleMs: unknown = Reflect.get(value, 'idleMs');
  if (idleMs !== undefined && (typeof idleMs !== 'number' || !Number.isSafeInteger(idleMs) || idleMs < 1_000)) return null;
  return value as DesktopBridge;
}
