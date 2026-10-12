/**
 * Hosts que o servidor da interface atende (decisão 0016). A checagem de origem das Server Actions do Next compara
 * `Origin` com `Host`, o que não pega DNS rebinding: um site cujo nome passa a apontar para 127.0.0.1 manda os dois
 * com o nome dele, e eles batem. Por isso o proxy recusa qualquer `Host` fora desta lista antes de qualquer página
 * ou ação. A porta não importa (o rebinding troca o nome, não a porta).
 */
const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set([
  // Desenvolvimento e `next start`: só na própria máquina.
  '127.0.0.1',
  'localhost',
  '[::1]',
  // App instalado: endereço interno que o Electron intercepta (não existe na internet).
  'jesus.invalid',
]);

/** Nome do host sem a porta; `null` se o cabeçalho estiver vazio ou malformado. */
export function hostnameOf(host: string): string | null {
  const value = host.trim().toLowerCase();
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(value);
  return match?.[1] ?? null;
}

/**
 * O pedido pode ser atendido: `Host` na lista e, se o pedido trouxer `X-Forwarded-Host` (o Next usa esse cabeçalho
 * no lugar do `Host` quando confere a origem das ações), ele também na lista.
 */
export function isAllowedRequestHost(host: string | null, forwardedHost: string | null): boolean {
  if (host === null) return false;
  const name = hostnameOf(host);
  if (name === null || !ALLOWED_HOSTNAMES.has(name)) return false;
  if (forwardedHost === null) return true;
  const forwarded = hostnameOf(forwardedHost);
  return forwarded !== null && ALLOWED_HOSTNAMES.has(forwarded);
}
