/**
 * Cadência da página aberta (decisão 0015): a conferência da sessão e o sinal de uso saem bem antes do tempo sem
 * uso acabar, para que um usuário ativo nunca seja bloqueado por atraso do sinal. Com 15 min: a cada 30 s; com o
 * mínimo de 1 min: a cada 15 s.
 */
/**
 * Hora de mandar um sinal de uso? `now` e `last` vêm de um relógio monotônico (`performance.now()`): com o relógio
 * de parede, uma hora que volta descartaria todo sinal até alcançar o carimbo antigo, e o usuário ativo seria
 * bloqueado. Relógio que anda para trás (não deveria) também manda, por segurança do usuário ativo.
 */
export function shouldSignal(now: number, last: number, everyMs: number): boolean {
  return !(now - last >= 0 && now - last < everyMs);
}

export function sessionTimings(idleMs: number): { readonly checkEveryMs: number; readonly activityEveryMs: number } {
  const safeIdle = Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 60_000;
  const every = Math.max(5_000, Math.min(30_000, Math.floor(safeIdle / 4)));
  return { checkEveryMs: every, activityEveryMs: every };
}
