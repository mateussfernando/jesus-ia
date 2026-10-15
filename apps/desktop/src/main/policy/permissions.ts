import { isAppOrigin } from './url';

/**
 * Permissões que uma página pode pedir ao Chromium (câmera, microfone, notificação, localização, área de
 * transferência...). Na fase 1, tudo é negado (seção 3.12). Na fase 1.5 (voz), só o microfone da própria janela do
 * app, no quadro principal, e só com o modo voz ligado (decisão 0012; seção 7.1).
 */

export interface PermissionRequest {
  readonly permission: string;
  readonly requestingOrigin: string;
  readonly isMainFrame: boolean;
  /** Tipos de mídia pedidos (`'audio'`, `'video'`), quando a permissão é `media`. */
  readonly mediaTypes?: readonly string[];
}

export interface PermissionPolicy {
  /** Modo voz ligado (fase 1.5). Desligado na fase 1. */
  readonly voice: boolean;
}

export const phase1PermissionPolicy: PermissionPolicy = { voice: false };

export function decidePermission(request: PermissionRequest, policy: PermissionPolicy): boolean {
  if (!policy.voice) return false;
  if (request.permission !== 'media' || !request.isMainFrame || !isAppOrigin(request.requestingOrigin)) return false;
  const types = request.mediaTypes ?? [];
  return types.length > 0 && types.every((type) => type === 'audio');
}
