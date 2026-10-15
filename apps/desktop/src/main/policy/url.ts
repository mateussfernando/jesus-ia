/**
 * Endereços que a janela do Jesus pode abrir (seção 3.12; decisão 0016): só https://jesus.invalid, sem usuário, senha
 * nem porta. Tudo o mais (outros sites, http, file:, data:, javascript:, blob: de fora) é recusado.
 */

export const APP_HOSTNAME = 'jesus.invalid';
export const APP_ORIGIN = `https://${APP_HOSTNAME}`;

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** O endereço é do próprio app. */
export function isAppUrl(raw: string): boolean {
  const url = parse(raw);
  if (url === null) return false;
  return (
    url.protocol === 'https:' &&
    url.hostname === APP_HOSTNAME &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

/** A janela pode navegar para lá (só páginas do app; nada de sites, arquivos ou esquemas especiais). */
export function isAllowedNavigation(raw: string): boolean {
  return isAppUrl(raw);
}

/** A origem de um quadro (frame) é a do app; o vigia de quadros acusa qualquer outra, inclusive a opaca ("null"). */
export function isAppOrigin(origin: string): boolean {
  return origin === APP_ORIGIN;
}
