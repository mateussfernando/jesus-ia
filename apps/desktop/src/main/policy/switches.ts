/**
 * Chaves de linha de comando e variáveis de ambiente (seção 3.13). Os fusíveis do Electron não cobrem
 * `--remote-debugging-port` e parentes: com eles, qualquer programa do PC (inclusive um comando do agente, na fase 3)
 * abriria o Jesus com depuração remota e clicaria nos próprios cartões de confirmação. Por isso, no app de produção, o
 * Jesus não aceita nenhuma chave nem argumento: tudo fora da lista branca (hoje vazia) faz o app sair. O mesmo vale
 * para as variáveis `ELECTRON_*`, que o executável lê sozinho antes de qualquer código do app (por exemplo,
 * `ELECTRON_DISABLE_SANDBOX` desliga a sandbox de todas as páginas). O build de teste, usado só pelos testes de ponta
 * a ponta, aceita as chaves de que o Playwright precisa.
 */

import electronEnvironment from './electron-environment.json';

/** Argumentos aceitos no app de produção. O Jesus não tem opções de linha de comando. */
const PRODUCTION_ALLOWED: ReadonlySet<string> = new Set();

/** Argumentos inesperados (tudo depois do executável que não está na lista branca). Vazio = pode abrir. */
export function unexpectedArguments(argv: readonly string[], options: { readonly testBuild: boolean }): string[] {
  if (options.testBuild) return [];
  return argv.slice(1).filter((arg) => !PRODUCTION_ALLOWED.has(arg));
}

/**
 * Variáveis `ELECTRON_*` aceitas no app de produção (`electron-environment.json`, lido também pelo
 * `check-package.mjs`):
 * - `neutralized`: o executável lê, mas sem efeito. `ELECTRON_RUN_AS_NODE` fica inerte com o fusível `RunAsNode`
 *   desligado; `ELECTRON_NO_ATTACH_CONSOLE` só decide se o app usa o console de quem o abriu (o VS Code define as duas
 *   nos processos que abre);
 * - `toolNames` e `toolPrefixes`: das ferramentas de download e build (`electron`, `@electron/get`, electron-builder).
 *   O executável não as lê; o `check-package.mjs` confere que nenhuma aparece nele.
 */
function allowedElectronVariable(upper: string): boolean {
  return (
    electronEnvironment.neutralized.includes(upper) ||
    electronEnvironment.toolNames.includes(upper) ||
    electronEnvironment.toolPrefixes.some((prefix) => upper.startsWith(prefix))
  );
}

/**
 * Variáveis de ambiente que fazem o app de produção sair: qualquer `ELECTRON_*` fora da lista acima. No Windows, o nome
 * de variável não diferencia maiúsculas, e o executável lê `electron_disable_sandbox` como `ELECTRON_DISABLE_SANDBOX`.
 * Devolve só os nomes (o valor pode ser segredo e não vai para o registro).
 */
export function unexpectedEnvironment(env: Readonly<Record<string, string | undefined>>, options: { readonly testBuild: boolean }): string[] {
  if (options.testBuild) return [];
  return Object.keys(env).filter((name) => {
    const upper = name.toUpperCase();
    return upper.startsWith('ELECTRON_') && !allowedElectronVariable(upper);
  });
}

/**
 * Regra do resolvedor de nomes do Chromium: nenhum nome resolve. O app não usa nome nenhum pela rede do Chromium
 * (`jesus.invalid` é atendido pelo `protocol.handle`, e o proxy morto é um IP), e a pré-resolução de DNS da página
 * (`<link rel="dns-prefetch">`) não passa pelo proxy nem pela CSP: sem esta regra, um nome como
 * `<dados>.atacante.example` chegaria ao DNS do sistema. A rede do agente (etapa 9) sai pelo Node, fora do Chromium.
 */
export const HOST_RESOLVER_RULES = 'MAP * ~NOTFOUND';

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
