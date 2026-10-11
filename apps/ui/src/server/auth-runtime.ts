import 'server-only';
import { join } from 'node:path';
import { bcryptHasher, createAuthService } from '@jesus/auth';
import type { AuthService, CredentialRepo, LockPolicy } from '@jesus/auth';
import { accessTransition, checkAccess, idlePolicyFromEnv, initialAccessState, openSession } from './access';
import type { AccessState } from './access';
import { createFileCredentialRepo } from './file-credential-repo';
import { newSessionToken } from './session';

/**
 * Login local no servidor do Next (decisões 0015 e 0016). Um único estado por processo: no app de desktop, o
 * servidor só atende a janela do próprio Jesus (sem porta aberta), então "desbloqueado" vale para o app.
 *
 * Configuração por ambiente (o processo principal do Electron preenche na fase 1):
 * - `JESUS_DATA_DIR`: pasta do arquivo da credencial (padrão: `.jesus-dev`, só para desenvolvimento).
 * - `JESUS_IDLE_MINUTES`: tempo sem uso até bloquear (1 a 120; padrão 15).
 * - `JESUS_HTTPS=1`: o app roda em https (cookie com `Secure`).
 */

export interface AuthRuntime {
  readonly service: AuthService;
  readonly policy: LockPolicy;
  readonly secureCookies: boolean;
  state: AccessState;
}

const RUNTIME_KEY = Symbol.for('jesus.ui.auth-runtime');
type RuntimeHolder = typeof globalThis & { [RUNTIME_KEY]?: Promise<AuthRuntime> };

async function createRepo(): Promise<CredentialRepo> {
  const dir = process.env['JESUS_DATA_DIR'] ?? join(process.cwd(), '.jesus-dev');
  return Promise.resolve(createFileCredentialRepo(join(dir, 'credentials.json')));
}

async function buildRuntime(): Promise<AuthRuntime> {
  const service = createAuthService({
    repo: await createRepo(),
    clock: { now: () => Date.now() },
    hasher: bcryptHasher(),
    // Auditoria de verdade (tabela encadeada por hash) chega na fase 2; aqui, só o tipo do evento, sem dados.
    audit: (event) => console.info(`[auth] ${event.type}`),
  });
  const policy = idlePolicyFromEnv(process.env['JESUS_IDLE_MINUTES']);
  const exists = (await service.status()) === 'ready';
  const { state } = accessTransition(initialAccessState, { e: 'CREDENTIAL_LOADED', now: Date.now(), exists }, policy);
  return { service, policy, secureCookies: process.env['JESUS_HTTPS'] === '1', state };
}

/**
 * O mesmo estado para páginas, Server Actions e rotas, mesmo que o Next carregue este módulo mais de uma vez
 * (camadas diferentes do build): por isso o estado mora num símbolo global do processo.
 */
export function getAuthRuntime(): Promise<AuthRuntime> {
  const holder = globalThis as RuntimeHolder;
  holder[RUNTIME_KEY] ??= buildRuntime();
  return holder[RUNTIME_KEY];
}

/** Acesso do pedido atual; com `activity`, conta como uso (adia o bloqueio por tempo sem uso). */
export function readAccess(runtime: AuthRuntime, token: string | undefined, activity: boolean): boolean {
  const result = checkAccess(runtime.state, token, Date.now(), runtime.policy, { activity });
  runtime.state = result.state;
  return result.unlocked;
}

/** Abre a sessão depois de um desbloqueio certo e devolve o token para o cookie. */
export function beginSession(runtime: AuthRuntime): string {
  const { token, tokenHash } = newSessionToken();
  runtime.state = openSession(runtime.state, tokenHash, Date.now(), runtime.policy).state;
  return token;
}

/** Bloqueia agora (pedido seu). */
export function lockRuntime(runtime: AuthRuntime): void {
  runtime.state = accessTransition(runtime.state, { e: 'LOCK_REQUESTED', now: Date.now() }, runtime.policy).state;
}
