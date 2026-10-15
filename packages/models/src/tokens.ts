import type { TokenizerFamily } from './types';

/**
 * Estimativa de tokens sem o tokenizador do provedor (docs/rascunhos/algoritmo-contexto.md, seção 7.1).
 * É só a estimativa inicial: no app, ela é ancorada no uso real devolvido pela API e calibrada por modelo.
 */

export interface CharCounts {
  /** Letras e dígitos ASCII e espaço. */
  word: number;
  /** Latim com acento (U+00C0–U+024F). */
  accent: number;
  /** Pontuação e símbolos ASCII. */
  punct: number;
  /** Han, Hiragana, Katakana e Hangul. */
  cjk: number;
  /** O resto (um par substituto conta como 1). */
  other: number;
}

type ClassWeights = CharCounts;

/** Tokens por caractere de cada classe, por família de tokenizador. */
const WEIGHTS: Record<TokenizerFamily, ClassWeights> = {
  openai_o200k: { word: 0.25, accent: 0.5, punct: 0.6, cjk: 0.9, other: 1.5 },
  claude: { word: 0.3, accent: 0.55, punct: 0.6, cjk: 1.0, other: 1.5 },
  deepseek: { word: 0.27, accent: 0.5, punct: 0.6, cjk: 0.7, other: 1.5 },
  qwen: { word: 0.27, accent: 0.5, punct: 0.6, cjk: 0.7, other: 1.5 },
  gemini: { word: 0.25, accent: 0.5, punct: 0.6, cjk: 0.8, other: 1.5 },
  llama: { word: 0.27, accent: 0.5, punct: 0.6, cjk: 1.0, other: 1.5 },
  mistral: { word: 0.27, accent: 0.5, punct: 0.6, cjk: 1.0, other: 1.5 },
  unknown: { word: 0.3, accent: 0.6, punct: 0.7, cjk: 1.2, other: 2.0 },
};

/** Custo fixo por mensagem (papel e separadores). */
export const TOKENS_PER_MESSAGE = 4;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function countCharClasses(text: string): CharCounts {
  const counts: CharCounts = { word: 0, accent: 0, punct: 0, cjk: 0, other: 0 };
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x20) {
      counts.word++;
    } else if (code >= 0x21 && code <= 0x7e) {
      counts.punct++;
    } else if (code >= 0xc0 && code <= 0x24f) {
      counts.accent++;
    } else if (CJK.test(ch)) {
      counts.cjk++;
    } else {
      counts.other++;
    }
  }
  return counts;
}

/** Tokens estimados de um texto (arredonda para cima; texto vazio = 0). */
export function estimateTextTokens(text: string, family: TokenizerFamily): number {
  const counts = countCharClasses(text);
  const w = WEIGHTS[family];
  const raw = counts.word * w.word + counts.accent * w.accent + counts.punct * w.punct + counts.cjk * w.cjk + counts.other * w.other;
  return raw <= 0 ? 0 : Math.ceil(raw - 1e-9); // tolera o erro de ponto flutuante (11,0000000001 → 11, não 12)
}

/** Tokens estimados de uma lista de mensagens de texto, com o custo fixo por mensagem. */
export function estimateMessagesTokens(messages: readonly string[], family: TokenizerFamily): number {
  return messages.reduce((sum, text) => sum + TOKENS_PER_MESSAGE + estimateTextTokens(text, family), 0);
}
