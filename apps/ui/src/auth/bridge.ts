import { bcryptHasher, createAuthService, createMemoryCredentialRepo } from '@jesus/auth';
import type { AuthService } from '@jesus/auth';

/**
 * Ponte entre a tela de entrada e o login local (decisão 0015).
 *
 * No app de desktop, o preload do Electron expõe `window.jesus.auth` pelo `contextBridge`: a senha vai por IPC
 * ao processo principal, que confere o hash bcrypt guardado no banco e devolve só o resultado. A interface
 * nunca vê o hash nem decide sozinha que está desbloqueada.
 *
 * No navegador (laboratório, sem Electron), não existe ponte: a tela roda em **modo de demonstração**, com o
 * mesmo serviço e o mesmo bcrypt, mas tudo em memória. Nada é guardado e recarregar a página zera tudo.
 */
export type AuthBridge = Pick<AuthService, 'status' | 'setup' | 'unlock' | 'recover'>;

declare global {
  interface Window {
    /** Ponte do preload do Electron (fase 1). Ausente no navegador. */
    readonly jesus?: { readonly auth?: AuthBridge };
  }
}

export interface ResolvedBridge {
  readonly bridge: AuthBridge;
  readonly demo: boolean;
}

/** A ponte do Electron, se existir. */
export function nativeAuthBridge(): AuthBridge | null {
  if (typeof window === 'undefined') return null;
  return window.jesus?.auth ?? null;
}

/** Demonstração no navegador: serviço real, bcrypt com o custo de produção, armazenamento só em memória. */
export function createDemoAuthBridge(): AuthBridge {
  return createAuthService({
    repo: createMemoryCredentialRepo(),
    clock: { now: () => Date.now() },
    hasher: bcryptHasher(),
  });
}

export function resolveAuthBridge(): ResolvedBridge {
  const native = nativeAuthBridge();
  return native === null ? { bridge: createDemoAuthBridge(), demo: true } : { bridge: native, demo: false };
}
