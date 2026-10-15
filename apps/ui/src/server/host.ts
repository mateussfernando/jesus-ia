/**
 * Hosts que o servidor da interface atende (decisão 0016). A checagem de origem das Server Actions do Next compara
 * `Origin` com `Host`, o que não pega DNS rebinding: um site cujo nome passa a apontar para 127.0.0.1 manda os dois
 * com o nome dele, e eles batem. Por isso o proxy recusa qualquer `Host` fora desta lista antes de qualquer página
 * ou ação. A porta não importa (o rebinding troca o nome, não a porta).
 */
/** Desenvolvimento e `next start`: só a própria máquina (e o endereço interno do app, que não resolve fora dele). */
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', 'jesus.invalid']);
/**
 * App instalado (`JESUS_HTTPS=1`): só o endereço interno que o Electron intercepta (não existe na internet). O
 * servidor nem tem porta ali; a lista curta é defesa a mais, caso ele um dia fique exposto por engano.
 */
const APP_HOSTNAMES: ReadonlySet<string> = new Set(['jesus.invalid']);

/** Nome do host sem a porta; `null` se o cabeçalho estiver vazio ou malformado. */
export function hostnameOf(host: string): string | null {
  const value = host.trim().toLowerCase();
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(value);
  return match?.[1] ?? null;
}

/**
 * O pedido pode ser atendido: `Host` na lista e, se o pedido trouxer `X-Forwarded-Host` (o Next usa esse cabeçalho
 * no lugar do `Host` quando confere a origem das ações), ele também na lista. `appMode` é o app instalado.
 */
export function isAllowedRequestHost(host: string | null, forwardedHost: string | null, appMode = false): boolean {
  const allowed = appMode ? APP_HOSTNAMES : LOCAL_HOSTNAMES;
  if (host === null) return false;
  const name = hostnameOf(host);
  if (name === null || !allowed.has(name)) return false;
  if (forwardedHost === null) return true;
  const forwarded = hostnameOf(forwardedHost);
  return forwarded !== null && allowed.has(forwarded);
}
