import { describeDenial } from '@jesus/gate';
import type { ToolFailure } from './outcome';
import { formatCount } from './text';

/** A falha em texto, para o modelo (que procura outro caminho, sem contornar) e para a tela. Nunca repete o caminho. */
export function describeFailure(failure: ToolFailure): string {
  switch (failure.reason) {
    case 'input':
      return 'Parâmetros inválidos para esta ferramenta.';
    case 'denied':
      return describeDenial(failure.denial);
    case 'not_found':
      return 'Não achei esse caminho. Confira o nome listando a pasta (file_list).';
    case 'no_access':
      return 'O sistema não deixa ler esse caminho (sem permissão).';
    case 'busy':
      return 'O arquivo está aberto em outro programa que não deixa ler agora. Feche-o e tente de novo.';
    case 'changed':
      return 'O arquivo mudou enquanto era conferido. Tente de novo.';
    case 'loop':
      return 'O caminho passa por links demais (ou por um link que volta para si mesmo).';
    case 'io':
      return 'Erro ao ler do disco.';
    case 'binary':
      return 'O arquivo não é texto (imagem, PDF, documento do Word, planilha ou outro binário). Por enquanto, o Jesus só lê arquivos de texto.';
    case 'offset':
      return `O arquivo tem ${formatCount(failure.lines)} ${failure.lines === 1 ? 'linha' : 'linhas'}; a linha pedida passa do fim.`;
    case 'cancelled':
      return 'A leitura foi interrompida.';
  }
}

/**
 * A falha num código curto, sem caminho nem conteúdo, para o registro de auditoria: `not_found`, `binary`,
 * `denied:outside:real`, `denied:path:unc:requested`, `denied:sensitive:ssh:real`, `denied:hardlink`.
 */
export function failureCode(failure: ToolFailure): string {
  if (failure.reason !== 'denied') return failure.reason;
  const { denial } = failure;
  const which = 'which' in denial ? `:${denial.which}` : '';
  switch (denial.reason) {
    case 'path':
      return `denied:path:${denial.problem}${which}`;
    case 'sensitive':
      return `denied:sensitive:${denial.kind}${which}`;
    case 'kind':
      return `denied:kind:${denial.actual}`;
    default:
      return `denied:${denial.reason}${which}`;
  }
}
