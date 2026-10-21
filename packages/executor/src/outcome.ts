import type { ReadDenial } from '@jesus/gate';
import type { SecretKind } from '@jesus/shared';
import type { ToolName } from './catalog';

/** Problemas do disco, em poucas classes (a mensagem do sistema leva o caminho e não vai a lugar nenhum). */
export type FsProblem = 'not_found' | 'no_access' | 'busy' | 'changed' | 'loop' | 'io';

export type ToolFailure =
  /** A entrada não passou no esquema estrito (ou a ferramenta não existe). */
  | { readonly reason: 'input' }
  /** O Porteiro negou: pelo caminho pedido, pelo alvo de um link ou pelo caminho real. */
  | { readonly reason: 'denied'; readonly denial: ReadDenial }
  | { readonly reason: FsProblem }
  /** Imagem, PDF, documento do Word, planilha ou outro binário: a fase 1 só lê texto. */
  | { readonly reason: 'binary' }
  /** A primeira linha pedida passa do fim do arquivo. */
  | { readonly reason: 'offset'; readonly lines: number }
  | { readonly reason: 'cancelled' };

/** Por que a busca parou antes de olhar tudo. */
export type SearchStop = 'results' | 'files' | 'bytes' | 'entries' | 'time';

/** O que aconteceu, sem conteúdo nem caminho: para o registro de auditoria e para a tela. */
export type ToolStats =
  | { readonly tool: 'file_read'; readonly firstLine: number; readonly lastLine: number; readonly totalLines: number; readonly partial: boolean }
  | { readonly tool: 'file_list'; readonly shown: number; readonly total: number; readonly more: boolean }
  | { readonly tool: 'file_search'; readonly results: number; readonly files: number; readonly stopped: SearchStop | null };

/** O que cada ferramenta devolve; `runTool` põe o nome e a falha em texto. */
export type ToolResult =
  | { readonly ok: true; readonly text: string; readonly secrets: readonly SecretKind[]; readonly stats: ToolStats }
  | { readonly ok: false; readonly failure: ToolFailure };

export type ToolOutcome =
  | {
      readonly ok: true;
      readonly tool: ToolName;
      /** O resultado para o modelo: as notas do Jesus e o conteúdo, mascarado e embrulhado como dado. */
      readonly text: string;
      /** Os segredos mascarados (os tipos, nunca os valores). */
      readonly secrets: readonly SecretKind[];
      readonly stats: ToolStats;
    }
  | {
      readonly ok: false;
      readonly tool: ToolName | null;
      /** A falha em texto, para o modelo e para a tela. Nunca repete o caminho. */
      readonly text: string;
      readonly failure: ToolFailure;
    };
