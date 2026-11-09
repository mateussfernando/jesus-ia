import type { ReactNode } from 'react';
import { SessionKeeper } from '../../auth/SessionKeeper';
import { getAuthRuntime } from '../../server/auth-runtime';

/**
 * Telas que exigem o Jesus desbloqueado. A checagem de verdade fica em cada página (`requireUnlocked`) e em
 * cada Server Action; este layout só acrescenta o botão "Bloquear" e o sinal de uso.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const runtime = await getAuthRuntime();
  return (
    <>
      {children}
      <SessionKeeper idleMs={runtime.policy.idleMs} />
    </>
  );
}
