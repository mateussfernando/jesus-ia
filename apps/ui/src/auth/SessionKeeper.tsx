'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { checkSession, lockNow, touch } from '../app/(app)/actions';
import { sessionTimings } from './session-timing';
import './session.css';

/**
 * Volta para a tela de entrada quando o servidor bloqueia (tempo sem uso, botão, Windows, suspensão) e avisa o
 * servidor quando você usa a tela. Duas coisas separadas:
 * - a conferência periódica (e ao voltar a ficar visível) só pergunta se a sessão vale: não conta como uso, senão
 *   a janela aberta e parada nunca bloquearia;
 * - o sinal de uso sai só de tecla, clique ou rolagem de verdade, no máximo uma vez a cada `activityEveryMs`.
 */
export function SessionKeeper({ idleMs }: { idleMs: number }) {
  const router = useRouter();
  const lastActivity = useRef(0);

  useEffect(() => {
    const { checkEveryMs, activityEveryMs } = sessionTimings(idleMs);
    let alive = true;
    const follow = async (call: () => Promise<{ unlocked: boolean }>) => {
      try {
        const { unlocked } = await call();
        if (alive && !unlocked) router.replace('/entrar/');
      } catch {
        if (alive) router.replace('/entrar/');
      }
    };
    const check = () => {
      if (document.visibilityState === 'visible') void follow(checkSession);
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivity.current < activityEveryMs) return;
      lastActivity.current = now;
      void follow(touch);
    };
    const interval = setInterval(check, checkEveryMs);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('wheel', onActivity, { passive: true });
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('wheel', onActivity);
    };
  }, [router, idleMs]);

  return (
    <button
      type="button"
      className="lock-button"
      onClick={async () => {
        await lockNow();
        router.replace('/entrar/');
      }}
    >
      Bloquear
    </button>
  );
}
