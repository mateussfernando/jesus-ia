import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@jesus/shared/audit';
import type { ToolPolicy } from '../bridge/executor-protocol';
import type { ToolReply, ToolRequest } from './executor-process';
import { buildPlaces, LINUX_SYSTEM_FOLDERS } from './places';
import { createToolRelay } from './tool-relay';

const policy: ToolPolicy = { released: ['/home/teste/projetos'], places: { home: '/home/teste', localAppData: '/home/teste/.config', roamingAppData: '/home/teste/.config' } };
const OK: ToolReply = { ok: true, text: 'Linhas 1 a 1 de 1.', secrets: { password: 1 }, stats: { tool: 'file_read', firstLine: 1, lastLine: 1, totalLines: 1, partial: false } };

function setup(options: { policy?: ToolPolicy | null; audit?: (event: AuditEvent) => Promise<unknown>; reply?: ToolReply } = {}) {
  const runs: ToolRequest[] = [];
  const events: AuditEvent[] = [];
  const relay = createToolRelay({
    executor: {
      run: async (request) => {
        runs.push(request);
        return options.reply ?? OK;
      },
    },
    policy: () => (options.policy === undefined ? policy : options.policy),
    audit:
      options.audit ??
      (async (event) => {
        events.push(event);
      }),
    platform: 'linux',
  });
  return { relay, runs, events };
}

describe('chamadas de ferramenta no principal', () => {
  it('conferida, registrada antes e depois, executada com a política do momento', async () => {
    const { relay, runs, events } = setup();
    expect(await relay.call('file_read', { path: '/home/teste/projetos/a.txt', offset: 3 })).toEqual(OK);
    expect(runs).toEqual([{ name: 'file_read', input: { path: '/home/teste/projetos/a.txt', offset: 3 }, policy }]);
    expect(events).toEqual([
      { type: 'tool.call', tool: 'file_read', path: '/home/teste/projetos/a.txt', offset: 3 },
      { type: 'tool.result', tool: 'file_read', ok: true, stats: OK.ok ? OK.stats : null, secrets: { password: 1 } },
    ]);
  });

  it('nome ou entrada fora do catálogo: recusa sem rodar', async () => {
    const { relay, runs } = setup();
    expect(await relay.call('file_write', { path: '/x' })).toMatchObject({ ok: false, code: 'input' });
    expect(await relay.call('file_read', { path: '/home/teste/projetos/a.txt', extra: 1 })).toMatchObject({ ok: false, code: 'input' });
    expect(await relay.call('file_search', { path: '/home/teste/projetos', query: '' })).toMatchObject({ ok: false, code: 'input' });
    expect(runs).toEqual([]);
  });

  it('o caminho pedido passa pelo Porteiro aqui: o negado nem chega ao Executor', async () => {
    const { relay, runs, events } = setup();
    expect(await relay.call('file_read', { path: '/home/teste/.ssh/id_ed25519' })).toEqual({
      ok: false,
      code: 'denied:sensitive:ssh:requested',
      text: 'Leitura negada: chaves do SSH ou do GnuPG. O Jesus não lê esse tipo de arquivo.',
    });
    expect(await relay.call('file_list', { path: '/etc' })).toMatchObject({ ok: false, code: 'denied:outside:requested' });
    expect(runs).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['tool.denied', 'tool.denied']);
  });

  it('sem política ou sem registro: desligado, sem rodar', async () => {
    const off = setup({ policy: null });
    expect(await off.relay.call('file_read', { path: '/home/teste/projetos/a.txt' })).toMatchObject({ ok: false, code: 'unavailable' });
    const noAudit = setup({ audit: () => Promise.reject(new Error('sem registro')) });
    expect(await noAudit.relay.call('file_read', { path: '/home/teste/projetos/a.txt' })).toMatchObject({ ok: false, code: 'unavailable' });
    expect([...off.runs, ...noAudit.runs]).toEqual([]);
  });

  it('a falha do Executor vai ao registro com o código', async () => {
    const { relay, events } = setup({ reply: { ok: false, code: 'not_found', text: 'Não achei esse caminho.' } });
    expect(await relay.call('file_read', { path: '/home/teste/projetos/b.txt' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(events.at(-1)).toEqual({ type: 'tool.result', tool: 'file_read', ok: false, code: 'not_found' });
  });
});

describe('lugares do sistema', () => {
  it('caminho real de cada um, sem os inválidos nem repetidos; sem a pasta do usuário, erro', () => {
    const realpath = (path: string) => (path === '/home/link' ? '/mnt/disco/home' : path);
    const places = buildPlaces(
      {
        home: '/home/link',
        localAppData: '/home/link/.config',
        roamingAppData: '/home/link/.config',
        personal: ['/home/link/Documentos', undefined, 'relativo', '/home/link/Documentos'],
        system: LINUX_SYSTEM_FOLDERS,
        jesus: ['/home/link/.config/Jesus'],
      },
      'posix',
      realpath,
    );
    expect(places.home).toBe('/mnt/disco/home');
    expect(places.personal).toEqual(['/home/link/Documentos']);
    expect(places.system).toContain('/etc');
    expect(places).not.toHaveProperty('systemRoot');
    expect(() => buildPlaces({ home: 'relativo', localAppData: '/a', roamingAppData: '/a', personal: [], system: [], jesus: [] }, 'posix', () => null)).toThrow(
      'lugar do sistema inválido: home',
    );
  });
});
