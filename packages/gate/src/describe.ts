import type { PathProblem } from './path';
import type { ReadDenial } from './read-gate';
import type { ReleaseRefusal } from './release';
import type { SensitiveKind } from './sensitive';

/**
 * A negação em texto, para o modelo e para a tela (seção 3.4.1: a negação volta ao Cérebro, que procura um caminho
 * seguro, sem contornar). Nunca repete o caminho pedido: ele pode ter vindo de conteúdo externo.
 */

const PATH_TEXT: Readonly<Record<PathProblem, string>> = {
  empty: 'o caminho veio vazio',
  too_long: 'o caminho (ou um nome nele) é longo demais',
  control_char: 'o caminho tem caracteres invisíveis ou de controle',
  invalid_char: 'o caminho tem caracteres que não valem em nomes',
  not_absolute: 'o caminho precisa ser absoluto, com a letra da unidade (C:\\…)',
  unc: 'caminhos de rede (\\\\servidor\\pasta) não são lidos',
  device_namespace: 'caminhos com \\\\?\\ ou \\\\.\\ (dispositivos) não são lidos',
  stream: 'fluxos alternativos do NTFS (arquivo:fluxo) não são lidos',
  trailing_dot_space: 'nomes terminados em ponto ou espaço são ambíguos no Windows',
  reserved_name: 'nomes de dispositivo do Windows (CON, NUL, COM1…) não são lidos',
  short_name: 'nomes curtos (PROGRA~1) não são aceitos; use o nome completo',
};

const SENSITIVE_TEXT: Readonly<Record<SensitiveKind, string>> = {
  ssh: 'chaves do SSH ou do GnuPG',
  credentials: 'credenciais de nuvem ou de ferramentas',
  browser: 'perfil de navegador ou de e-mail (cookies, senhas salvas)',
  password_manager: 'cofre de gerenciador de senhas',
  windows: 'segredos do Windows',
  private_key: 'chave privada ou certificado',
  env_file: 'arquivo .env (variáveis com segredos)',
  crypto_wallet: 'carteira de criptomoeda',
  app_session: 'sessão de aplicativo de conversa',
};

export function describeDenial(denial: ReadDenial): string {
  const via = 'which' in denial && denial.which === 'real' ? 'O caminho leva (por link, atalho ou junção) a um lugar onde ' : '';
  switch (denial.reason) {
    case 'path':
      return `Leitura negada: ${PATH_TEXT[denial.problem]}.`;
    case 'jesus':
      return via === '' ? 'Leitura negada: as pastas do próprio Jesus não são lidas.' : `${via}o Jesus não lê: as pastas dele mesmo.`;
    case 'sensitive':
      return via === ''
        ? `Leitura negada: ${SENSITIVE_TEXT[denial.kind]}. O Jesus não lê esse tipo de arquivo.`
        : `${via}o Jesus não lê: ${SENSITIVE_TEXT[denial.kind]}.`;
    case 'outside':
      return via === ''
        ? 'Leitura negada: fora das pastas liberadas. Só o dono libera uma pasta, pela tela do Jesus.'
        : `${via}o Jesus não lê: fora das pastas liberadas.`;
    case 'kind':
      if (denial.actual === 'other') return 'Leitura negada: isso não é um arquivo nem uma pasta comum.';
      return denial.expected === 'file' ? 'Leitura negada: isso é uma pasta, não um arquivo.' : 'Leitura negada: isso é um arquivo, não uma pasta.';
    case 'hardlink':
      return 'Leitura negada: o arquivo tem mais de um nome (hardlink), e o mesmo conteúdo pode estar fora das pastas liberadas.';
  }
}

/** Por que a pasta escolhida não pode ser liberada, em texto para a tela (o caminho a tela já mostra). */
export function describeRelease(refusal: ReleaseRefusal): string {
  switch (refusal.reason) {
    case 'path':
      return `Essa pasta não pode ser liberada: ${PATH_TEXT[refusal.problem]}.`;
    case 'root':
      return 'A unidade inteira não pode ser liberada. Escolha uma pasta dentro dela.';
    case 'jesus':
      return 'As pastas do próprio Jesus não podem ser liberadas.';
    case 'sensitive':
      return `Essa pasta guarda ${SENSITIVE_TEXT[refusal.kind]} e não pode ser liberada.`;
    case 'too_broad':
      return 'A sua pasta de usuário inteira não pode ser liberada. Escolha uma pasta dentro dela.';
    case 'personal':
      return 'Documentos, Downloads, Área de Trabalho, Imagens, Vídeos e Música não podem ser liberados inteiros. Escolha uma pasta dentro deles.';
    case 'system':
      return 'Pastas do sistema e de programas instalados não podem ser liberadas.';
    case 'app_data':
      return 'As pastas de dados dos programas (AppData) não podem ser liberadas: guardam senhas, sessões e configurações.';
  }
}
