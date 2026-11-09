/**
 * Pote de cookies do processo principal (decisão 0016). O Electron atende o `protocol.handle` fora do serviço de rede
 * do Chromium: a resposta não grava o `Set-Cookie` e o pedido não leva o `Cookie`. Sem isto, a sessão da senha local
 * não sobrevive a uma navegação. O pote vale só para https://jesus.invalid e só na memória (a sessão da janela não
 * persiste nada em disco): fechar o app apaga tudo.
 *
 * Segue o essencial da RFC 6265 para um único host: `Path`, `Max-Age`/`Expires`, prefixos `__Host-`/`__Secure-`.
 * `Domain` só é aceito se for o próprio host; cookie malformado é ignorado sem derrubar nada.
 */

export const COOKIE_HOST = 'jesus.invalid';

const MAX_COOKIES = 50;
const MAX_COOKIE_BYTES = 4096;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// eslint-disable-next-line no-control-regex -- controle é exatamente o que precisa ser recusado no valor
const FORBIDDEN_VALUE = /[\u0000-\u001f\u007f;]/;

export type SameSite = 'strict' | 'lax' | 'none';

export interface StoredCookie {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  /** Instante em ms em que expira; `null` = cookie de sessão (vale até fechar o app). */
  readonly expiresAt: number | null;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: SameSite | null;
  readonly createdAt: number;
}

/** Resultado da leitura de um `Set-Cookie`: o cookie, ou a ordem de apagar (expirado), ou `null` se for inválido. */
export type ParsedSetCookie =
  | { readonly kind: 'store'; readonly cookie: StoredCookie }
  | { readonly kind: 'delete'; readonly name: string; readonly path: string };

function appUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== COOKIE_HOST || url.username !== '' || url.password !== '') {
    return null;
  }
  return url;
}

/** Caminho padrão de um cookie sem `Path` (RFC 6265, 5.1.4): o "diretório" do caminho do pedido. */
export function defaultCookiePath(requestPath: string): string {
  if (!requestPath.startsWith('/')) return '/';
  const lastSlash = requestPath.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : requestPath.slice(0, lastSlash);
}

/** O caminho do pedido casa com o caminho do cookie (RFC 6265, 5.1.4). */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
}

export function parseSetCookie(header: string, requestPath: string, now: number): ParsedSetCookie | null {
  if (header.length > MAX_COOKIE_BYTES) return null;
  const [pair = '', ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!TOKEN.test(name) || FORBIDDEN_VALUE.test(value)) return null;

  let path: string | null = null;
  let maxAge: number | null = null;
  let expires: number | null = null;
  let secure = false;
  let httpOnly = false;
  let sameSite: SameSite | null = null;
  let domain: string | null = null;
  for (const attribute of attributes) {
    const at = attribute.indexOf('=');
    const key = (at === -1 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
    const raw = at === -1 ? '' : attribute.slice(at + 1).trim();
    switch (key) {
      case 'path':
        path = raw.startsWith('/') ? raw : null;
        break;
      case 'max-age':
        if (/^-?\d+$/.test(raw)) maxAge = Number(raw);
        break;
      case 'expires': {
        const when = Date.parse(raw);
        if (Number.isFinite(when)) expires = when;
        break;
      }
      case 'secure':
        secure = true;
        break;
      case 'httponly':
        httpOnly = true;
        break;
      case 'samesite': {
        const lower = raw.toLowerCase();
        sameSite = lower === 'strict' || lower === 'lax' || lower === 'none' ? lower : null;
        break;
      }
      case 'domain':
        domain = raw.replace(/^\./, '').toLowerCase();
        break;
      default:
        break;
    }
  }
  if (domain !== null && domain !== '' && domain !== COOKIE_HOST) return null;
  // Prefixos: __Secure- exige Secure; __Host- exige Secure, Path=/ e nenhum Domain.
  if (name.startsWith('__Secure-') && !secure) return null;
  if (name.startsWith('__Host-') && (!secure || path !== '/' || (domain !== null && domain !== ''))) return null;

  const finalPath = path ?? defaultCookiePath(requestPath);
  // Max-Age vence Expires (RFC 6265, 5.3, passo 3).
  const expiresAt = maxAge !== null ? now + maxAge * 1000 : expires;
  if (expiresAt !== null && expiresAt <= now) return { kind: 'delete', name, path: finalPath };
  return {
    kind: 'store',
    cookie: { name, value, path: finalPath, expiresAt, secure, httpOnly, sameSite, createdAt: now },
  };
}

export class CookieJar {
  readonly #now: () => number;
  readonly #cookies = new Map<string, StoredCookie>();

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  /** Grava os `Set-Cookie` de uma resposta a um pedido para `url`. Pedidos de fora do app não gravam nada. */
  storeFromResponse(url: string, setCookies: readonly string[]): void {
    const target = appUrl(url);
    if (target === null) return;
    const now = this.#now();
    for (const header of setCookies) {
      const parsed = parseSetCookie(header, target.pathname, now);
      if (parsed === null) continue;
      if (parsed.kind === 'delete') {
        this.#cookies.delete(`${parsed.name}\u0000${parsed.path}`);
        continue;
      }
      const key = `${parsed.cookie.name}\u0000${parsed.cookie.path}`;
      const previous = this.#cookies.get(key);
      // Substituir mantém a data de criação (ordem estável do cabeçalho Cookie).
      const cookie = previous === undefined ? parsed.cookie : { ...parsed.cookie, createdAt: previous.createdAt };
      this.#cookies.delete(key);
      this.#cookies.set(key, cookie);
      if (this.#cookies.size > MAX_COOKIES) {
        const oldest = this.#cookies.keys().next();
        if (oldest.done !== true) this.#cookies.delete(oldest.value);
      }
    }
  }

  /** Cabeçalho `Cookie` para um pedido; `null` se não houver nenhum ou se o pedido não for do app. */
  headerFor(url: string): string | null {
    const target = appUrl(url);
    if (target === null) return null;
    const now = this.#now();
    const matching: StoredCookie[] = [];
    for (const [key, cookie] of this.#cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        this.#cookies.delete(key);
        continue;
      }
      if (pathMatches(target.pathname, cookie.path)) matching.push(cookie);
    }
    if (matching.length === 0) return null;
    // RFC 6265, 5.4: caminhos mais longos primeiro; empate, os mais antigos primeiro.
    matching.sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
    return matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  /** Apaga tudo (por exemplo, quando o servidor da interface reinicia: a sessão antiga não vale mais). */
  clear(): void {
    this.#cookies.clear();
  }

  get size(): number {
    return this.#cookies.size;
  }
}
