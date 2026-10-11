'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { lockNow, touch } from '../app/(app)/actions';
import './session.css';

/** Intervalo mínimo entre sinais de uso (o bloqueio por tempo sem uso conta em minutos). */
const TOUCH_EVERY_MS = 60_000;

/**
 * Mantém a sessão viva enquanto você usa a tela e volta para a tela de entrada quando o servidor bloqueia
 * (tempo sem uso, bloqueio do Windows, suspensão). Também oferece o botão "Bloquear".
 */
export function SessionKeeper() {
  const router = useRouter();
  const lastTouch = useRef(0);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      lastTouch.current = Date.now();
      try {
        const { unlocked } = await touch();
        if (alive && !unlocked) router.replace('/entrar/');
      } catch {
        if (alive) router.replace('/entrar/');
      }
    };
    const onActivity = () => {
      if (Date.now() - lastTouch.current >= TOUCH_EVERY_MS) void ping();
    };
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void ping();
    }, TOUCH_EVERY_MS);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointerdown', onActivity);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
    };
  }, [router]);

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
