/**
 * Metadados de um item do histórico. O conteúdo fica no banco; aqui só o que as decisões de contexto usam
 * (docs/rascunhos/algoritmo-contexto.md, seções 5.2 a 5.5).
 */

export type ContextItemKind =
  | 'user_request'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'harness_note'
  | 'user_attachment'
  | 'summary';

/** De onde veio o conteúdo: de fora (e-mail, web, arquivo de terceiros), do próprio Jesus ou do usuário. */
export type ItemOrigin = 'external' | 'local' | 'user';

/** Veredito da sonda de injeção sobre o conteúdo. */
export type ProbeVerdict = 'clean' | 'flagged' | 'unavailable';

export interface ContextItemMeta {
  /** Id estável do item no banco. */
  id: string;
  /** Posição no histórico (só cresce). */
  seq: number;
  /** Turno: cada pedido do usuário abre um. */
  turn: number;
  kind: ContextItemKind;
  /** Tokens do item como está no contexto. */
  tokens: number;
  origin: ItemOrigin;
  /** Chamada de ferramenta a que o item pertence (tool_call e tool_result). É a ref dos marcadores. */
  toolCallId?: string;
  toolName?: string;
  probe?: ProbeVerdict;
  /** O que foi lido (ex.: 'file:C:/notas.txt'). A mesma chave lida de novo torna a leitura antiga superada. */
  resourceKey?: string;
  isError?: boolean;
  /** A ação desta chamada ainda espera a sua confirmação. */
  pendingApproval?: boolean;
  /** Já virou marcador (limpo ou despejado). */
  cleared?: boolean;
}

/** Formato das refs (ids de chamada de ferramenta) aceitas em marcadores e em `context.recall`. */
export const REF_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

/** Formato aceito para o nome de ferramenta num marcador; nomes MCP vêm do servidor e não são confiáveis. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;
