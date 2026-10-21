import { describeRelease } from '@jesus/gate';
import { formatCount } from '@jesus/executor';
import { MAX_RELEASED_FOLDERS } from '../bridge/executor-protocol';
import type { AddResult, FolderStore, ReleasedFolder } from './folders';

/**
 * Liberar uma pasta (decisão 0026): só o dono, pelo diálogo nativo de escolher pasta. Nenhum caminho vem da página nem
 * do modelo: a página só pede que o diálogo abra. O principal pega o caminho real, o Porteiro confere
 * (`checkReleaseFolder`) e só então vem a confirmação, numa caixa nativa com texto feito aqui, com o caminho real e o
 * aviso de que o conteúdo lido vai para a Anthropic.
 */

export interface ReleaseFlowDeps {
  /** Abre o diálogo de escolher pasta; `null` se o dono cancelou. */
  pick(): Promise<string | null>;
  /** O caminho real (`realpath` nativo: junção, nome curto e unidade de rede resolvidos). */
  realpath(path: string): Promise<string>;
  /** A confirmação nativa; `true` só se o dono escolheu liberar. */
  confirm(text: ConfirmText): Promise<boolean>;
  readonly store: Pick<FolderStore, 'check' | 'add'>;
}

export interface ConfirmText {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

export type ReleaseFlowResult =
  | { readonly status: 'released'; readonly folder: ReleasedFolder }
  | { readonly status: 'cancelled' }
  | { readonly status: 'refused'; readonly message: string };

/** O texto da confirmação, feito por código com o caminho real (que já passou pelo Porteiro: sem invisíveis). */
export function confirmText(path: string): ConfirmText {
  return {
    title: 'Liberar pasta',
    message: `Deixar o Jesus ler esta pasta?\n\n${path}`,
    detail: [
      'O Jesus vai poder ler os arquivos de texto desta pasta e das subpastas, quando você pedir numa conversa.',
      'O que ele ler vai para a Anthropic (a empresa do modelo de IA) junto com a conversa.',
      'Segredos que o Jesus reconhece (senhas, chaves, cartões) saem mascarados, mas nem todos são reconhecidos: não libere pastas com senhas, documentos pessoais ou dados de outras pessoas.',
      'Você pode remover a pasta a qualquer hora, em Configurações.',
    ].join('\n\n'),
    confirmLabel: 'Liberar',
    cancelLabel: 'Cancelar',
  };
}

/** Por que não liberou, em texto para a tela (sem o caminho: a tela mostra a pasta escolhida por conta própria). */
export function describeAddFailure(result: Exclude<AddResult, { readonly ok: true }>): string {
  switch (result.reason) {
    case 'refused':
      return describeRelease(result.refusal);
    case 'duplicate':
      return 'Essa pasta já está liberada (ou fica dentro de uma pasta liberada).';
    case 'full':
      return `Já há ${formatCount(MAX_RELEASED_FOLDERS)} pastas liberadas. Remova uma antes de liberar outra.`;
    case 'unavailable':
      return 'Liberar pastas está desligado agora: o registro de auditoria do Jesus não abriu (ou foi posto de lado). Feche e abra o Jesus de novo.';
    case 'io':
      return 'Não deu para gravar a lista de pastas liberadas. Tente de novo.';
  }
}

export async function releaseFolderFlow(deps: ReleaseFlowDeps): Promise<ReleaseFlowResult> {
  const picked = await deps.pick();
  if (picked === null) return { status: 'cancelled' };
  let real: string;
  try {
    real = await deps.realpath(picked);
  } catch {
    return { status: 'refused', message: 'Não deu para abrir essa pasta.' };
  }
  const check = deps.store.check(real);
  if (!check.ok) return { status: 'refused', message: describeAddFailure(check) };
  if (!(await deps.confirm(confirmText(check.path.text)))) return { status: 'cancelled' };
  const added = await deps.store.add(check.path.text);
  return added.ok ? { status: 'released', folder: added.folder } : { status: 'refused', message: describeAddFailure(added) };
}
