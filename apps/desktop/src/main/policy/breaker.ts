/**
 * Disjuntor do vigia de quadros (seção 3.12). Toda violação derruba a sessão e volta a janela para o início, sem
 * exceção: pular uma (por exemplo, por ter vindo logo depois de outra) deixaria o conteúdo de fora na tela. O que
 * impede um laço de recargas é este disjuntor: violações demais em pouco tempo e o app fecha (falha fechada).
 */
export class ViolationBreaker {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #times: number[] = [];

  constructor(options: { limit: number; windowMs: number; now?: () => number }) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Registra uma violação; `true` quando passou do limite dentro da janela de tempo (hora de fechar o app). */
  record(): boolean {
    const now = this.#now();
    this.#times = this.#times.filter((time) => now - time < this.#windowMs);
    this.#times.push(now);
    return this.#times.length > this.#limit;
  }
}
