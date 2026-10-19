/**
 * Lê o uso (tokens) da resposta da API em SSE, no processo principal, para liquidar o gasto do dia (decisão 0023). Só
 * olha as linhas `data:` dos eventos `message_start`, `message_delta`, `message_stop` e `error`; os bytes seguem para o
 * Cérebro sem mudança nenhuma.
 *
 * O uso vem em duas partes: a entrada (com o cache) no `message_start` e a saída final no `message_delta` (que pode
 * repetir os campos, já somados). Linha grande demais, JSON inválido ou evento fora de ordem: o leitor desiste, e quem
 * chama cobra o pior caso.
 */

/** Uma linha de evento da API tem poucos KB; acima disso, algo está errado. */
const MAX_LINE_CHARS = 1024 * 1024;

const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;

export interface SseUsage {
  /** O objeto `usage` cru, somado do `message_start` com o `message_delta` (vai ao `normalizeUsage('anthropic')`). */
  readonly raw: Readonly<Record<string, unknown>> | null;
  /** Chegou a saída final (`message_delta` com uso). */
  readonly final: boolean;
  /** A API mandou um evento `error` no meio da resposta. */
  readonly streamError: string | null;
  /** O leitor desistiu (linha grande demais, JSON inválido): o uso não é confiável. */
  readonly broken: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class SseUsageReader {
  readonly #decoder = new TextDecoder('utf-8');
  #partial = '';
  #raw: Record<string, unknown> | null = null;
  #final = false;
  #streamError: string | null = null;
  #broken = false;

  push(chunk: Uint8Array): void {
    if (this.#broken) return;
    this.#consume(this.#decoder.decode(chunk, { stream: true }));
  }

  end(): void {
    if (this.#broken) return;
    this.#consume(`${this.#decoder.decode()}\n`);
  }

  get result(): SseUsage {
    return { raw: this.#raw, final: this.#final, streamError: this.#streamError, broken: this.#broken };
  }

  #consume(text: string): void {
    const lines = (this.#partial + text).split('\n');
    this.#partial = lines.pop() ?? '';
    if (this.#partial.length > MAX_LINE_CHARS) {
      this.#broken = true;
      return;
    }
    for (const line of lines) {
      if (this.#broken) return;
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (clean.length > MAX_LINE_CHARS) {
        this.#broken = true;
        return;
      }
      if (!clean.startsWith('data:')) continue;
      this.#data(clean.slice(5).trimStart());
    }
  }

  #data(payload: string): void {
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      this.#broken = true;
      return;
    }
    if (!isRecord(event)) return;
    switch (event['type']) {
      case 'message_start': {
        const message = event['message'];
        if (this.#raw !== null || !isRecord(message) || !isRecord(message['usage'])) {
          this.#broken = true;
          return;
        }
        this.#raw = { ...message['usage'] };
        return;
      }
      case 'message_delta': {
        const usage = event['usage'];
        if (this.#raw === null || !isRecord(usage)) {
          this.#broken = true;
          return;
        }
        // Os números do `message_delta` já são o total: substituem os do começo.
        for (const field of USAGE_FIELDS) if (usage[field] !== undefined && usage[field] !== null) this.#raw[field] = usage[field];
        if (usage['cache_creation'] !== undefined) this.#raw['cache_creation'] = usage['cache_creation'];
        this.#final = true;
        return;
      }
      case 'error': {
        const error = event['error'];
        const kind = isRecord(error) && typeof error['type'] === 'string' ? error['type'] : 'error';
        this.#streamError = kind.slice(0, 64);
        return;
      }
      default:
        return;
    }
  }
}
