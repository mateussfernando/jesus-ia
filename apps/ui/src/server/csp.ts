/**
 * Política de segurança das páginas (seção 3.12; decisão 0016). Com o servidor do Next ligado, cada resposta
 * recebe um nonce novo: o Next aplica o nonce aos próprios scripts e estilos, e nenhum script sem o nonce roda.
 * Sem `unsafe-inline` e, fora do desenvolvimento, sem `unsafe-eval`.
 */

const NONCE_BYTES = 18;

/** Nonce aleatório em base64 (18 bytes = 144 bits, sem `=` no fim). */
export function createNonce(random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(NONCE_BYTES);
  if (bytes.length !== NONCE_BYTES) throw new RangeError('fonte de aleatoriedade devolveu tamanho errado');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const NONCE = /^[A-Za-z0-9+/]{24}$/;

export function buildCsp(nonce: string, options: { dev: boolean }): string {
  if (!NONCE.test(nonce)) throw new RangeError('nonce inválido');
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic': os scripts carregados por um script com nonce (os pedaços do Next) também rodam.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Em desenvolvimento, o recarregamento automático usa WebSocket no próprio servidor local.
    `connect-src 'self'${options.dev ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
    "object-src 'none'",
    // Nenhum quadro, worker ou service worker (seção 3.12): o app não usa, e um quadro de fora é o caminho clássico
    // de conteúdo que não é do app. No desktop, o vigia de quadros do processo principal é a segunda barreira.
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join('; ');
}

/** Cabeçalhos extras de todas as respostas. O microfone fica liberado só para o próprio app (voz, fase 1.5). */
export const securityHeaders: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
};
