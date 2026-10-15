/**
 * Chaves de linha de comando (seção 3.13). Os fusíveis do Electron não cobrem `--remote-debugging-port` e parentes:
 * com eles, qualquer programa do PC (inclusive um comando do agente, na fase 3) abriria o Jesus com depuração remota e
 * clicaria nos próprios cartões de confirmação. Por isso, no app de produção, o Jesus não aceita nenhuma chave nem
 * argumento: tudo fora da lista branca (hoje vazia) faz o app sair. O build de teste, usado só pelos testes de ponta
 * a ponta, aceita as chaves de que o Playwright precisa.
 */

/** Argumentos aceitos no app de produção. O Jesus não tem opções de linha de comando. */
const PRODUCTION_ALLOWED: ReadonlySet<string> = new Set();

/** Argumentos inesperados (tudo depois do executável que não está na lista branca). Vazio = pode abrir. */
export function unexpectedArguments(argv: readonly string[], options: { readonly testBuild: boolean }): string[] {
  if (options.testBuild) return [];
  return argv.slice(1).filter((arg) => !PRODUCTION_ALLOWED.has(arg));
}

/**
 * Junta as listas de recursos do Chromium num valor só: com duas chaves `--disable-features`, o Chromium usa só a
 * última, e uma desligaria a outra sem aviso.
 */
export function mergeFeatureList(...lists: readonly (readonly string[])[]): string {
  const seen = new Set<string>();
  for (const list of lists) for (const feature of list) if (/^[A-Za-z0-9]+$/.test(feature)) seen.add(feature);
  return [...seen].join(',');
}

/** Recursos do Chromium desligados pelo app: sem mDNS do WebRTC, nenhuma porta UDP 5353 fica em escuta. */
export const APP_DISABLED_FEATURES: readonly string[] = ['WebRtcHideLocalIpsWithMdns'];
