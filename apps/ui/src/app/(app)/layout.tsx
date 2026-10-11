import type { ReactNode } from 'react';
import { SessionKeeper } from '../../auth/SessionKeeper';

/**
 * Telas que exigem o Jesus desbloqueado. A checagem de verdade fica em cada página (`requireUnlocked`) e em
 * cada Server Action; este layout só acrescenta o botão "Bloquear" e o sinal de uso.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SessionKeeper />
    </>
  );
}
