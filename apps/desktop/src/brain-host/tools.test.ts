import { describe, expect, it } from 'vitest';
import { parseFromBrain } from '../bridge/brain-protocol';
import { BRIDGE_BUSY, BRIDGE_TIMED_OUT, BUDGET_REFUSALS, readTools, ToolBridge, ToolFailure } from './tools';
import { MAX_TURN_TOOL_CALLS, TurnBudget } from './turn-budget';

/** A ponte das ferramentas no Cérebro (decisão 0026), com o "principal" sendo a lista de mensagens que saíram. */
function setup(options: { maxCalls?: number; windowMs?: number; timeoutMs?: number; failPost?: boolean } = {}) {
  const sent: unknown[] = [];
  let clock = 0;
  const bridge = new ToolBridge({
    post: (message) => {
      if (options.failPost === true) throw new Error('o principal sumiu');
      sent.push(message);
    },
    now: () => clock,
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
    ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return {
    bridge,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ponte das ferramentas no Cérebro', () => {
  it('a chamada sai com o id do turno e volta só com o texto; tudo o que sai passa no protocolo', async () => {
    const { bridge, sent } = setup();
    const outcome = bridge.call(7, 'file_read', { path: 'C:\\Users\\dono\\Projetos\\a.txt' });
    expect(sent).toEqual([{ type: 'tool-call', id: 1, turn: 7, name: 'file_read', input: { path: 'C:\\Users\\dono\\Projetos\\a.txt' } }]);
    for (const message of sent) expect(parseFromBrain(message)).not.toBeNull();
    expect(bridge.pending).toBe(1);
    bridge.handle({ type: 'tool-result', id: 1, ok: true, text: 'conteúdo' });
    expect(await outcome).toEqual({ ok: true, text: 'conteúdo' });
    expect(bridge.pending).toBe(0);
  });

  it('cada chamada tem o seu id; resposta a um id sem chamada em aberto é ignorada', async () => {
    const { bridge } = setup();
    const first = bridge.call(1, 'file_list', { path: '/a' });
    const second = bridge.call(1, 'file_list', { path: '/b' });
    bridge.handle({ type: 'tool-result', id: 2, ok: false, text: 'não achei' });
    bridge.handle({ type: 'tool-result', id: 2, ok: true, text: 'repetida' });
    bridge.handle({ type: 'tool-result', id: 99, ok: true, text: 'inventada' });
    expect(await second).toEqual({ ok: false, text: 'não achei' });
    bridge.handle({ type: 'tool-result', id: 1, ok: true, text: 'a' });
    expect(await first).toEqual({ ok: true, text: 'a' });
  });

  it('Parar: o sinal cancela a chamada (tool-cancel) e a resposta atrasada é ignorada', async () => {
    const { bridge, sent } = setup();
    const controller = new AbortController();
    const outcome = bridge.call(3, 'file_search', { path: '/a', query: 'x' }, controller.signal);
    controller.abort();
    await expect(outcome).rejects.toThrow();
    expect(sent.at(-1)).toEqual({ type: 'tool-cancel', id: 1 });
    expect(parseFromBrain(sent.at(-1))).not.toBeNull();
    expect(bridge.pending).toBe(0);
    bridge.handle({ type: 'tool-result', id: 1, ok: true, text: 'tarde demais' });
    // Sinal que já chegou abortado: nada sai.
    const aborted = new AbortController();
    aborted.abort();
    await expect(bridge.call(3, 'file_list', { path: '/a' }, aborted.signal)).rejects.toThrow();
    expect(sent).toHaveLength(2);
  });

  it('sem resposta a tempo, a chamada é cancelada e o modelo recebe um texto', async () => {
    const { bridge, sent } = setup({ timeoutMs: 5 });
    const outcome = await bridge.call(1, 'file_read', { path: '/a' });
    expect(outcome).toEqual(BRIDGE_TIMED_OUT);
    expect(sent.at(-1)).toEqual({ type: 'tool-cancel', id: 1 });
    expect(bridge.pending).toBe(0);
  });

  it('acima do ritmo, a chamada é recusada aqui, sem sair; passada a janela, volta a sair', async () => {
    const { bridge, sent, advance } = setup({ maxCalls: 2, windowMs: 1_000 });
    void bridge.call(1, 'file_list', { path: '/a' });
    void bridge.call(1, 'file_list', { path: '/b' });
    expect(await bridge.call(1, 'file_list', { path: '/c' })).toEqual(BRIDGE_BUSY);
    expect(sent).toHaveLength(2);
    advance(1_000);
    void bridge.call(1, 'file_list', { path: '/d' });
    expect(sent).toHaveLength(3);
    bridge.failAll('fim');
  });

  it('o principal some: as chamadas em aberto terminam com o texto dado; mensagem que não sai rejeita', async () => {
    const { bridge } = setup();
    const outcome = bridge.call(1, 'file_read', { path: '/a' });
    bridge.failAll('O Jesus está reiniciando.');
    expect(await outcome).toEqual({ ok: false, text: 'O Jesus está reiniciando.' });
    const broken = setup({ failPost: true });
    await expect(broken.bridge.call(1, 'file_read', { path: '/a' })).rejects.toThrow('o principal sumiu');
    expect(broken.bridge.pending).toBe(0);
  });
});

describe('ferramentas do turno (readTools)', () => {
  async function run(tools: ReturnType<typeof readTools>, input: { path: string }) {
    const execute = tools.file_read.execute;
    if (execute === undefined) throw new Error('a ferramenta precisa executar');
    return execute(input, { toolCallId: 'toolu_1', messages: [], context: undefined as never });
  }

  it('a falha do principal vira erro com o texto dele (que vai à API como is_error)', async () => {
    const { bridge, sent } = setup();
    const budget = new TurnBudget(100_000, 100);
    const tools = readTools({ bridge, turn: 4, budget, estimate: (text) => text.length });
    const pending = run(tools, { path: '/fora/a.txt' });
    await tick();
    expect(sent).toEqual([{ type: 'tool-call', id: 1, turn: 4, name: 'file_read', input: { path: '/fora/a.txt' } }]);
    bridge.handle({ type: 'tool-result', id: 1, ok: false, text: 'Esse caminho fica fora das pastas liberadas.' });
    const error: unknown = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolFailure);
    // O texto vai ao modelo como está, sem o nome do erro na frente.
    expect(String(error)).toBe('Esse caminho fica fora das pastas liberadas.');
  });

  it('o orçamento do turno recusa antes de sair: nem vai ao principal', async () => {
    const { bridge, sent } = setup();
    // Sem espaço para uma reserva.
    const full = readTools({ bridge, turn: 1, budget: new TurnBudget(10_000, 9_000), estimate: (text) => text.length });
    await expect(run(full, { path: '/a' })).rejects.toThrow(BUDGET_REFUSALS.context);
    // Passado o número de chamadas do turno.
    const budget = new TurnBudget(100_000_000, 100);
    for (let call = 0; call < MAX_TURN_TOOL_CALLS; call++) {
      expect(budget.reserve()).toBeNull();
      budget.settle(1);
    }
    const many = readTools({ bridge, turn: 1, budget, estimate: (text) => text.length });
    await expect(run(many, { path: '/a' })).rejects.toThrow(BUDGET_REFUSALS.calls);
    expect(sent).toEqual([]);
  });
});
