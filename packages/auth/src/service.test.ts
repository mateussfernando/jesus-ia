import { describe, expect, it } from 'vitest';
import { createMemoryCredentialRepo } from './credentials';
import { bcryptHasher, createAuthService } from './service';
import type { AuthAuditEvent, AuthPorts } from './service';

const MIN = 60_000;
const GOOD = 'girassol azul na janela';
const OTHER = 'outra frase bem comprida';

function setupHarness(overrides: Partial<AuthPorts> = {}) {
  let now = 1_000_000;
  const repo = createMemoryCredentialRepo();
  const events: AuthAuditEvent[] = [];
  let codes = 0;
  const service = createAuthService({
    repo,
    clock: { now: () => now },
    // Custo 4 deixa os testes rápidos; o custo de produção (12) é testado no @jesus/crypto.
    hasher: bcryptHasher(4),
    newRecoveryCode: () => {
      codes++;
      return codes === 1 ? 'ABCDE-FGHJK-MNPQR-STVWX' : '0123A-4567B-89CDE-FGHJK';
    },
    audit: (e) => events.push(e),
    ...overrides,
  });
  return { service, repo, events, advance: (ms: number) => (now += ms) };
}

describe('primeira configuração', () => {
  it('cria a senha, guarda só hashes bcrypt e mostra o código de recuperação uma vez', async () => {
    const { service, repo, events } = setupHarness();
    expect(await service.status()).toBe('setup_required');
    const result = await service.setup(GOOD);
    expect(result).toEqual({ ok: true, recoveryCode: 'ABCDE-FGHJK-MNPQR-STVWX' });
    const stored = repo.snapshot();
    expect(stored?.passwordHash).toMatch(/^\$2b\$04\$/);
    expect(stored?.recoveryHash).toMatch(/^\$2b\$04\$/);
    expect(JSON.stringify(stored)).not.toContain(GOOD);
    expect(JSON.stringify(stored)).not.toContain('ABCDE');
    expect(await service.status()).toBe('ready');
    expect(events).toEqual([{ type: 'auth.setup', at: 1_000_000 }]);
  });

  it('recusa senha fraca e não deixa configurar duas vezes', async () => {
    const { service } = setupHarness();
    expect(await service.setup('123456789012')).toEqual({ ok: false, reason: 'weak_password', problems: ['common'] });
    expect((await service.setup(GOOD)).ok).toBe(true);
    expect(await service.setup(OTHER)).toEqual({ ok: false, reason: 'already_set' });
  });
});

describe('desbloquear', () => {
  it('aceita a senha certa e recusa a errada sem espera nas 5 primeiras', async () => {
    const { service } = setupHarness();
    expect(await service.unlock(GOOD)).toEqual({ ok: false, reason: 'not_set' });
    await service.setup(GOOD);
    expect(await service.unlock(GOOD)).toEqual({ ok: true });
    for (let i = 1; i <= 4; i++) {
      expect(await service.unlock('errada')).toEqual({
        ok: false,
        reason: 'wrong_password',
        retryAfterMs: 0,
        freeAttemptsLeft: 5 - i,
      });
    }
  });

  it('depois do 5º erro, espera 30 s; tentar antes nem confere a senha', async () => {
    const { service, advance, repo } = setupHarness();
    await service.setup(GOOD);
    for (let i = 0; i < 4; i++) await service.unlock('errada');
    expect(await service.unlock('errada')).toMatchObject({ reason: 'wrong_password', retryAfterMs: 30_000 });
    advance(10_000);
    // Até a senha certa espera: senão a espera não serviria contra quem chuta.
    expect(await service.unlock(GOOD)).toEqual({ ok: false, reason: 'throttled', retryAfterMs: 20_000 });
    expect(repo.snapshot()?.failedAttempts).toBe(5);
    advance(20_000);
    expect(await service.unlock(GOOD)).toEqual({ ok: true });
    expect(repo.snapshot()?.failedAttempts).toBe(0);
  });

  it('a espera dobra a cada erro e para em 15 min', async () => {
    const { service, advance } = setupHarness();
    await service.setup(GOOD);
    const waits: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await service.unlock('errada');
      if (!r.ok && r.reason === 'wrong_password') waits.push(r.retryAfterMs);
      advance(16 * MIN);
    }
    expect(waits).toEqual([0, 0, 0, 0, 30_000, MIN, 2 * MIN, 4 * MIN, 8 * MIN, 15 * MIN, 15 * MIN]);
  });

  it('refaz o hash quando o custo sobe', async () => {
    const repo = createMemoryCredentialRepo();
    const weak = createAuthService({ repo, clock: { now: () => 0 }, hasher: bcryptHasher(4) });
    await weak.setup(GOOD);
    const stronger = createAuthService({ repo, clock: { now: () => 0 }, hasher: bcryptHasher(5) });
    expect(await stronger.unlock(GOOD)).toEqual({ ok: true });
    expect(repo.snapshot()?.passwordHash).toMatch(/^\$2b\$05\$/);
  });

  it('duas tentativas ao mesmo tempo: a segunda é recusada como ocupada', async () => {
    const { service } = setupHarness();
    await service.setup(GOOD);
    const [a, b] = await Promise.all([service.unlock('errada'), service.unlock('errada 2')]);
    expect(a).toMatchObject({ reason: 'wrong_password' });
    expect(b).toEqual({ ok: false, reason: 'busy' });
  });

  it('a auditoria nunca leva senha, hash nem código', async () => {
    const { service, events } = setupHarness();
    await service.setup(GOOD);
    await service.unlock('errada');
    await service.unlock(GOOD);
    const text = JSON.stringify(events);
    expect(text).not.toContain(GOOD);
    expect(text).not.toContain('errada');
    expect(text).not.toContain('$2b$');
  });
});

describe('trocar e recuperar a senha', () => {
  it('troca com a senha atual; a antiga deixa de valer', async () => {
    const { service } = setupHarness();
    await service.setup(GOOD);
    expect(await service.changePassword('errada', OTHER)).toMatchObject({ ok: false, reason: 'wrong_password' });
    expect(await service.changePassword(GOOD, 'curta')).toMatchObject({ ok: false, reason: 'weak_password' });
    expect(await service.changePassword(GOOD, OTHER)).toEqual({ ok: true });
    expect(await service.unlock(GOOD)).toMatchObject({ ok: false });
    expect(await service.unlock(OTHER)).toEqual({ ok: true });
  });

  it('recupera com o código (aceita minúsculas e espaços) e troca o código usado', async () => {
    const { service } = setupHarness();
    await service.setup(GOOD);
    const result = await service.recover('abcde fghjk mnpqr stvwx', OTHER);
    expect(result).toEqual({ ok: true, recoveryCode: '0123A-4567B-89CDE-FGHJK' });
    expect(await service.unlock(OTHER)).toEqual({ ok: true });
    // O código antigo não vale mais.
    expect(await service.recover('ABCDE-FGHJK-MNPQR-STVWX', GOOD)).toMatchObject({ ok: false, reason: 'invalid_code' });
  });

  it('código errado ou malformado conta na mesma espera que a senha', async () => {
    const { service, repo } = setupHarness();
    await service.setup(GOOD);
    for (let i = 0; i < 3; i++) await service.unlock('errada');
    expect(await service.recover('nada a ver', OTHER)).toMatchObject({ reason: 'invalid_code', freeAttemptsLeft: 1 });
    expect(await service.recover('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', OTHER)).toMatchObject({ reason: 'invalid_code', retryAfterMs: 30_000 });
    expect(repo.snapshot()?.failedAttempts).toBe(5);
    expect(await service.recover('ABCDE-FGHJK-MNPQR-STVWX', OTHER)).toMatchObject({ reason: 'throttled' });
  });
});
