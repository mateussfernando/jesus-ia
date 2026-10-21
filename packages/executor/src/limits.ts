/**
 * Os cortes das ferramentas de leitura (decisão 0026). Valem para o tempo, a memória e o contexto do modelo: um arquivo
 * enorme, uma pasta com milhares de itens ou uma busca que não acaba não podem prender o Executor nem lotar a conversa.
 */
export interface ExecutorLimits {
  /** `file_read`: bytes lidos do começo do arquivo (o resto fica de fora, com aviso). */
  readonly readBytes: number;
  /** Caracteres do conteúdo na resposta de qualquer ferramenta (as linhas, os itens e os resultados param antes). */
  readonly responseChars: number;
  /** Caracteres de uma linha na resposta (o resto da linha é cortado, com aviso). */
  readonly lineChars: number;
  /** `file_list`: itens lidos da pasta. */
  readonly listScan: number;
  /** `file_list`: itens mostrados. */
  readonly listEntries: number;
  /** `file_search`: níveis de subpasta. */
  readonly searchDepth: number;
  /** `file_search`: itens de pasta visitados (com as subpastas). */
  readonly searchEntries: number;
  /** `file_search`: arquivos examinados. */
  readonly searchFiles: number;
  /** `file_search`: maior arquivo lido. */
  readonly searchFileBytes: number;
  /** `file_search`: bytes lidos ao todo. */
  readonly searchTotalBytes: number;
  /** `file_search`: resultados. */
  readonly searchResults: number;
  /** `file_search`: tempo (ms). */
  readonly searchMillis: number;
  /** Caracteres de um trecho achado. */
  readonly snippetChars: number;
  /** Links seguidos num caminho (um laço de links para aqui). */
  readonly linkHops: number;
}

export const DEFAULT_LIMITS: ExecutorLimits = Object.freeze({
  readBytes: 10 * 1024 * 1024,
  responseChars: 40_000,
  lineChars: 2_000,
  listScan: 10_000,
  listEntries: 500,
  searchDepth: 10,
  searchEntries: 50_000,
  searchFiles: 5_000,
  searchFileBytes: 2 * 1024 * 1024,
  searchTotalBytes: 50 * 1024 * 1024,
  searchResults: 100,
  searchMillis: 10_000,
  snippetChars: 200,
  linkHops: 32,
});

/** Pastas que a busca pula (repositórios e dependências: milhares de arquivos que não são do dono). */
export const SEARCH_SKIPPED_DIRS: ReadonlySet<string> = new Set(['.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv']);
