import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@jesus/shared/audit';
import type { ToolPolicy } from '../bridge/executor-protocol';
import type { BrainToolCall } from '../bridge/tool-protocol';
import { UNAVAILABLE } from './executor-process';
import type { ToolReply, ToolRequest } from './executor-process';
import { buildPlaces, LINUX_SYSTEM_FOLDERS } from './places';
import { createBrainToolHandler, createToolRelay, TURN_ENDED } from './tool-relay';
import type { ToolRelay } from './tool-relay';

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

describe('chamadas de ferramenta do Cérebro (quem atende)', () => {
  const CALL: BrainToolCall = { type: 'tool-call', id: 4, turn: 2, name: 'file_read', input: { path: '/home/teste/projetos/a.txt' } };

  function handlerSetup(turn: 'running' | 'ended' | 'unknown', relay?: ToolRelay, call: BrainToolCall = CALL) {
    const runs: { name: string; input: unknown; signal: AbortSignal | undefined }[] = [];
    const replies: { ok: boolean; text: string }[] = [];
    const violations: string[] = [];
    const lines: [number, { title: string; detail: string }][] = [];
    const handler = createBrainToolHandler({
      relay: relay ?? {
        call: (name, input, signal) => {
          runs.push({ name, input, signal });
          return Promise.resolve(OK);
        },
      },
      turnState: () => turn,
      onActivity: (id, line) => lines.push([id, line]),
    });
    const cancel = handler(call, (result) => replies.push(result), (reason) => violations.push(reason));
    return { runs, replies, violations, cancel, lines };
  }

  it('a linha de atividade sai com o resumo feito por código, só para a chamada de um turno em andamento', () => {
    expect(handlerSetup('running').lines).toEqual([[2, { title: 'Ler arquivo', detail: '/home/teste/projetos/a.txt' }]]);
    const search: BrainToolCall = { type: 'tool-call', id: 5, turn: 2, name: 'file_search', input: { path: '/home/teste', query: 'a\u202Eb' } };
    expect(handlerSetup('running', undefined, search).lines).toEqual([[2, { title: 'Procurar texto', detail: '"ab" em /home/teste' }]]);
    // Entrada que não confere com o esquema: sem linha (o repassador recusa a chamada).
    const bad: BrainToolCall = { type: 'tool-call', id: 6, turn: 2, name: 'file_read', input: { path: '/a', extra: 1 } };
    expect(handlerSetup('running', undefined, bad).lines).toEqual([]);
    expect(handlerSetup('ended').lines).toEqual([]);
    expect(handlerSetup('unknown').lines).toEqual([]);
  });

  it('dentro de um turno em andamento: roda, e ao Cérebro volta só o texto (sem resumo nem tipos de segredo)', async () => {
    const { runs, replies, violations } = handlerSetup('running');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(runs.map((run) => [run.name, run.input])).toEqual([['file_read', { path: '/home/teste/projetos/a.txt' }]]);
    expect(replies).toEqual([{ ok: true, text: OK.text }]);
    expect(violations).toEqual([]);
  });

  it('cancelar aborta a chamada no repassador', () => {
    const { runs, cancel } = handlerSetup('running');
    expect(runs[0]?.signal?.aborted).toBe(false);
    cancel();
    expect(runs[0]?.signal?.aborted).toBe(true);
  });

  it('turno que já terminou (corrida com o Parar): recusa sem rodar e sem derrubar o Cérebro', () => {
    const { runs, replies, violations } = handlerSetup('ended');
    expect(runs).toEqual([]);
    expect(replies).toEqual([{ ok: false, text: TURN_ENDED.text }]);
    expect(violations).toEqual([]);
  });

  it('turno que o principal nunca pediu: fuga do protocolo, sem rodar', () => {
    const { runs, replies, violations } = handlerSetup('unknown');
    expect(runs).toEqual([]);
    expect(replies).toEqual([]);
    expect(violations).toEqual(['chamada de ferramenta num turno que o principal não pediu']);
  });

  it('repassador que falha por dentro: o Cérebro recebe uma resposta mesmo assim', async () => {
    const { replies } = handlerSetup('running', { call: () => Promise.reject(new Error('quebrou')) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(replies).toEqual([{ ok: false, text: UNAVAILABLE.text }]);
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
