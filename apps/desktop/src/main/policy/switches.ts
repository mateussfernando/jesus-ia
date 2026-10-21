/**
 * Chaves de linha de comando e variáveis de ambiente (seção 3.13). Os fusíveis do Electron não cobrem
 * `--remote-debugging-port` e parentes: com eles, qualquer programa do PC (inclusive um comando do agente, na fase 3)
 * abriria o Jesus com depuração remota e clicaria nos próprios cartões de confirmação. Por isso, no app de produção, o
 * Jesus não aceita nenhuma chave nem argumento: tudo fora da lista branca (hoje vazia) faz o app sair. O mesmo vale
 * para as variáveis `ELECTRON_*` e `NODE_*`, que o executável e o Node do processo principal leem sozinhos antes de
 * qualquer código do app (por exemplo, `ELECTRON_DISABLE_SANDBOX` desliga a sandbox de todas as páginas, e
 * `NODE_DEBUG=https` imprime no stderr as opções de cada conexão). O build de teste, usado só pelos testes de ponta a
 * ponta, aceita as chaves de que o Playwright precisa.
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
 * Variáveis `NODE_*` aceitas no app de produção: as que não mudam nada no processo principal. O resto faz o app sair,
 * porque o Node as lê sozinho ao iniciar e algumas mudam o que ele faz:
 * - `NODE_DEBUG` e `NODE_DEBUG_NATIVE` imprimem objetos internos no stderr (com `NODE_DEBUG=https`, as opções de cada
 *   conexão; o transporte já não põe a chave nelas, e esta recusa é a segunda barreira);
 * - `NODE_COMPILE_CACHE` carrega código já compilado de uma pasta fora do `app.asar` (o limite que sobra está na
 *   seção 3.13);
 * - cada Node novo (cada Electron novo) pode trazer variáveis novas, e uma lista de aceitas não deixa passar nenhuma.
 *
 * As aceitas:
 * - `NODE_OPTIONS`: sem efeito, com o fusível `NodeOptions` desligado;
 * - `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_TLS_REJECT_UNAUTHORIZED` e `NODE_USE_ENV_PROXY`: o transporte da
 *   saída para a API as ignora por construção (decisão 0023), e o principal registra os nomes;
 * - `NODE_PATH`: só vale para o `require` do CommonJS, e o principal é ESM e só importa o próprio pacote e o Node;
 * - `NODE_ENV`: o principal não lê, e os filhos recebem `production` fixo;
 * - `NODE_NO_WARNINGS`, `NODE_PENDING_DEPRECATION` e `NODE_DISABLE_COLORS`: só mudam os avisos do Node.
 * Os filhos não recebem nenhuma `NODE_*` (ambiente por lista, `child-env.ts`).
 */
const NODE_ALLOWED: ReadonlySet<string> = new Set([
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_USE_ENV_PROXY',
  'NODE_PATH',
  'NODE_ENV',
  'NODE_NO_WARNINGS',
  'NODE_PENDING_DEPRECATION',
  'NODE_DISABLE_COLORS',
]);

/**
 * Variáveis de ambiente que fazem o app de produção sair: qualquer `ELECTRON_*` ou `NODE_*` fora das listas acima. No
 * Windows, o nome de variável não diferencia maiúsculas, e o executável lê `electron_disable_sandbox` como
 * `ELECTRON_DISABLE_SANDBOX`. Devolve só os nomes (o valor pode ser segredo e não vai para o registro).
 */
export function unexpectedEnvironment(env: Readonly<Record<string, string | undefined>>, options: { readonly testBuild: boolean }): string[] {
  if (options.testBuild) return [];
  return Object.keys(env).filter((name) => {
    const upper = name.toUpperCase();
    if (upper.startsWith('ELECTRON_')) return !allowedElectronVariable(upper);
    if (upper.startsWith('NODE_')) return !NODE_ALLOWED.has(upper);
    return false;
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
