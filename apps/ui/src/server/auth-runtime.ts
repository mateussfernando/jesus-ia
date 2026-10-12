import 'server-only';
import { bcryptHasher, createAuthService } from '@jesus/auth';
import type { AuthAuditEvent, AuthService, CredentialRepo, LockPolicy } from '@jesus/auth';
import {
  accessTransition,
  checkAccess,
  createAccessClock,
  idlePolicyFromEnv,
  initialAccessState,
  lockedSinceOf,
  openSession,
} from './access';
import type { AccessState, SessionOpening } from './access';
import { credentialStoreFromEnv } from './credential-store';
import { createFileCredentialRepo } from './file-credential-repo';
import { newSessionToken } from './session';

/**
 * Login local no servidor do Next (decisões 0015 e 0016). Um único estado por processo: no app de desktop, o
 * servidor só atende a janela do próprio Jesus (sem porta aberta), então "desbloqueado" vale para o app.
 *
 * Configuração por ambiente (o processo principal do Electron preenche na fase 1):
 * - `JESUS_DATABASE_URL`: PostgreSQL da senha (tabela `app_credentials`, migrada com `npm run db:apply -w @jesus/db`).
 *   Sai do ambiente do processo assim que é lida: nenhum processo filho a herda.
 * - `JESUS_DATA_DIR`: sem banco, pasta do arquivo da credencial (padrão: `.jesus-dev`, só para desenvolvimento).
 * - `JESUS_IDLE_MINUTES`: tempo sem uso até bloquear (1 a 120; padrão 15).
 * - `JESUS_HTTPS=1`: o app roda em https (cookie com `Secure`).
 */

export interface AuthRuntime {
  readonly service: AuthService;
  readonly policy: LockPolicy;
  readonly secureCookies: boolean;
  /** Relógio do estado de acesso (nunca volta; veja `createAccessClock`). A espera da senha usa o de parede. */
  readonly now: () => number;
  state: AccessState;
}

const RUNTIME_KEY = Symbol.for('jesus.ui.auth-runtime');
const REPO_KEY = Symbol.for('jesus.ui.credential-repo');
type RuntimeHolder = typeof globalThis & {
  [RUNTIME_KEY]?: Promise<AuthRuntime> | undefined;
  [REPO_KEY]?: Promise<CredentialRepo>;
};

async function createRepo(): Promise<CredentialRepo> {
  const store = credentialStoreFromEnv(process.env, process.cwd());
  // A URL traz a senha do banco (invariante 5): fica só na memória deste processo.
  delete process.env['JESUS_DATABASE_URL'];
  if (store.kind === 'file') return createFileCredentialRepo(store.path);
  // Carregado só quando há banco: sem `JESUS_DATABASE_URL`, o driver do PostgreSQL nem entra no processo.
  const [{ createDbClient }, { createCredentialRepo }] = await Promise.all([
    import('@jesus/db/client'),
    import('@jesus/db/credentials'),
  ]);
  return createCredentialRepo(createDbClient(store.url));
}

/**
 * O repositório é escolhido uma vez por processo e nunca muda: uma nova tentativa depois de o banco falhar usa o
 * mesmo banco (e falha de novo, fechada), nunca cai para o arquivo. Erro de configuração também fica até reiniciar.
 */
function credentialRepo(): Promise<CredentialRepo> {
  const holder = globalThis as RuntimeHolder;
  holder[REPO_KEY] ??= createRepo();
  return holder[REPO_KEY];
}

/** Só o tipo do evento e a operação: nada de senha, hash ou código (a auditoria de verdade chega na fase 2). */
function auditLine(event: AuthAuditEvent): string {
  return 'op' in event ? `[auth] ${event.type} (${event.op})` : `[auth] ${event.type}`;
}

async function buildRuntime(): Promise<AuthRuntime> {
  const service = createAuthService({
    repo: await credentialRepo(),
    clock: { now: () => Date.now() },
    hasher: bcryptHasher(),
    audit: (event) => console.info(auditLine(event)),
  });
  const policy = idlePolicyFromEnv(process.env['JESUS_IDLE_MINUTES']);
  const now = createAccessClock();
  const exists = (await service.status()) === 'ready';
  const { state } = accessTransition(initialAccessState, { e: 'CREDENTIAL_LOADED', now: now(), exists }, policy);
  return { service, policy, secureCookies: process.env['JESUS_HTTPS'] === '1', now, state };
}

/**
 * O mesmo estado para páginas, Server Actions e rotas, mesmo que o Next carregue este módulo mais de uma vez
 * (camadas diferentes do build): por isso o estado mora num símbolo global do processo. Se a montagem falhar
 * (arquivo ilegível, banco fora do ar), o pedido falha fechado e o próximo tenta de novo, com o mesmo
 * repositório (`credentialRepo`).
 */
export function getAuthRuntime(): Promise<AuthRuntime> {
  const holder = globalThis as RuntimeHolder;
  holder[RUNTIME_KEY] ??= buildRuntime().catch((error: unknown) => {
    holder[RUNTIME_KEY] = undefined;
    throw error;
  });
  return holder[RUNTIME_KEY];
}

/** Acesso do pedido atual; com `activity`, conta como uso (adia o bloqueio por tempo sem uso). */
export function readAccess(runtime: AuthRuntime, token: string | undefined, activity: boolean): boolean {
  const result = checkAccess(runtime.state, token, runtime.now(), runtime.policy, { activity });
  runtime.state = result.state;
  return result.unlocked;
}

/** Marca do estado bloqueado no começo de uma conferência de senha (veja `openSession`). */
export function beginCheck(runtime: AuthRuntime): SessionOpening {
  readAccess(runtime, undefined, false);
  return { via: 'unlock', lockedSince: lockedSinceOf(runtime.state) };
}

/**
 * Abre a sessão depois de criar a senha ou de uma conferência certa e devolve o token para o cookie; `null` se a
 * máquina de estados não desbloqueou (por exemplo, um bloqueio chegou durante a conferência).
 */
export function beginSession(runtime: AuthRuntime, opening: SessionOpening): string | null {
  const { token, tokenHash } = newSessionToken();
  runtime.state = openSession(runtime.state, tokenHash, runtime.now(), runtime.policy, opening).state;
  return runtime.state.sessionHash === tokenHash ? token : null;
}

/** Bloqueia agora (pedido seu). */
export function lockRuntime(runtime: AuthRuntime): void {
  runtime.state = accessTransition(runtime.state, { e: 'LOCK_REQUESTED', now: runtime.now() }, runtime.policy).state;
}
