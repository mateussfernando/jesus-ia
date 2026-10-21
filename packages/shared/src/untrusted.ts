/**
 * Dados de fora (arquivo lido, página, e-mail, resultado de ferramenta) vão ao modelo como **dado, nunca instrução**
 * (invariante 1; seção 3.3; decisão 0022). Duas peças:
 * - `escapeForPrompt`: tira o que esconde texto do usuário mas não do modelo (caracteres de tag Unicode, de largura
 *   zero, de direção) e troca `<` e `>` pelos de largura total, para o conteúdo não fechar o bloco nem abrir outro;
 * - `wrapUntrusted`: põe o conteúdo, já escapado, num bloco `<dados-externos>` com a origem.
 * O mascaramento de segredos vem antes, com `maskSecrets`, para quem chama saber o que foi mascarado (o registro
 * guarda isso). Nada disso torna o conteúdo confiável: é uma camada, e o Porteiro continua decidindo fora da IA.
 */

/**
 * Invisíveis que o modelo lê: tags Unicode (U+E0000 a U+E007F, o "contrabando ASCII"), largura zero (U+200B a U+200F),
 * junção e invisíveis de formatação (U+2060 a U+2064), BOM (U+FEFF) e controles de direção (U+202A a U+202E, U+2066 a
 * U+2069).
 */
const INVISIBLE = /[\u{E0000}-\u{E007F}\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/gu;

/** Controles C0 e C1, menos tabulação e quebra de linha. */
// eslint-disable-next-line no-control-regex -- tirar os caracteres de controle é o objetivo desta expressão.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function escapeForPrompt(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replaceAll('<', '\uFF1C')
    .replaceAll('>', '\uFF1E');
}

export interface UntrustedContent {
  /** De onde veio: o nome da ferramenta (`file.read`) ou da fonte. Só letras, dígitos, ponto, hífen e sublinhado. */
  readonly source: string;
  readonly content: string;
}

const SOURCE = /^[A-Za-z0-9._-]{1,64}$/;

export function wrapUntrusted(input: UntrustedContent): string {
  if (!SOURCE.test(input.source)) throw new Error('origem de dados externos inválida');
  return `<dados-externos origem="${input.source}">\n${escapeForPrompt(input.content)}\n</dados-externos>`;
}
