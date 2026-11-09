/**
 * Depois de um bloqueio que não vem da página (Windows, suspensão, quadro de fora), a janela precisa sair da tela
 * protegida: o principal a manda para o início, que leva à entrada. Se em poucos segundos ela não passou pela entrada
 * (a navegação se perdeu), vai direto para lá. Visto uma vez no CI do Windows (etapa 11): a janela ficou no início
 * depois do aviso de bloqueio, e o início agora mostra a conversa. A sessão já tinha caído (cookies apagados e o
 * servidor da interface bloqueado), mas o que já estava desenhado ficaria na tela.
 */

/** O que o guarda usa da janela (no app, a `BrowserWindow`). */
export interface GuardedWindow {
  isDestroyed(): boolean;
  /** O endereço do documento na janela agora. */
  url(): string;
  load(url: string): void;
}

export interface EntryGuardOptions {
  /** A tela de entrada (`https://jesus.invalid/entrar/`). */
  readonly entryUrl: string;
  /** Quanto esperar a janela passar pela entrada antes de mandá-la direto. */
  readonly delayMs?: number;
  /** Avisado antes de cada ida direta (para o log e o registro), com o endereço em que a janela ficou. */
  readonly onRetry: (stuckAt: string) => void;
  readonly setTimer?: (run: () => void, ms: number) => void;
}

export interface EntryGuard {
  /** A janela terminou uma navegação (`did-navigate`). */
  navigated(url: string): void;
  /** O Jesus acabou de bloquear e mandou a janela para o início. */
  afterLock(win: GuardedWindow): void;
  /** Quantas vezes a janela precisou ir direto para a entrada. */
  readonly retries: number;
}

export const ENTRY_GUARD_DELAY_MS = 3_000;

export function createEntryGuard(options: EntryGuardOptions): EntryGuard {
  const setTimer =
    options.setTimer ??
    ((run: () => void, ms: number) => {
      setTimeout(run, ms).unref();
    });
  const isEntry = (url: string) => url === options.entryUrl || url.startsWith(`${options.entryUrl}?`) || url.startsWith(`${options.entryUrl}#`);
  let entries = 0;
  let retries = 0;
  return {
    navigated(url) {
      if (isEntry(url)) entries += 1;
    },
    afterLock(win) {
      const before = entries;
      setTimer(() => {
        // Passou pela entrada depois do bloqueio (mesmo que já tenha desbloqueado e voltado): nada a fazer.
        if (win.isDestroyed() || entries !== before) return;
        const current = win.url();
        if (isEntry(current)) return;
        retries += 1;
        options.onRetry(current);
        win.load(options.entryUrl);
      }, options.delayMs ?? ENTRY_GUARD_DELAY_MS);
    },
    get retries() {
      return retries;
    },
  };
}
