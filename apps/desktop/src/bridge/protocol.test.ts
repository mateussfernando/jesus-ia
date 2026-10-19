import { describe, expect, it } from 'vitest';
import {
  MAX_CHUNK_BYTES,
  MAX_HEADERS,
  MAX_REQUEST_BODY_BYTES,
  parseFromServer,
  parseRequestPortIn,
  parseRequestPortOut,
  parseToServer,
} from './protocol';

const meta = (over: Record<string, unknown> = {}) => ({
  url: 'https://jesus.invalid/entrar/',
  method: 'GET',
  headers: [['accept', 'text/html']],
  body: null,
  ...over,
});

describe('protocolo da ponte com o servidor da interface', () => {
  it('aceita configuração e pedido bem formados', () => {
    expect(parseToServer({ type: 'config', uiDir: '/app/ui', dataDir: '/dados' })).toEqual({
      type: 'config',
      uiDir: '/app/ui',
      dataDir: '/dados',
    });
    expect(parseToServer({ type: 'request', meta: meta() })?.type).toBe('request');
    const post = parseToServer({
      type: 'request',
      meta: meta({ method: 'POST', body: new Uint8Array([1, 2, 3]) }),
    });
    expect(post?.type === 'request' && post.meta.body?.byteLength).toBe(3);
  });

  it('recusa campo a mais, tipo desconhecido e caminho relativo na configuração', () => {
    expect(parseToServer({ type: 'config', uiDir: '/a', dataDir: '/b', extra: 1 })).toBeNull();
    expect(parseToServer({ type: 'config', uiDir: 'relativo', dataDir: '/b' })).toBeNull();
    expect(parseToServer({ type: 'config', uiDir: '/a\u0000b', dataDir: '/b' })).toBeNull();
    expect(parseToServer({ type: 'eval', code: '1' })).toBeNull();
    expect(parseToServer(null)).toBeNull();
    expect(parseToServer('config')).toBeNull();
  });

  it('pedido só para o app, com método da lista e corpo só em POST', () => {
    const bad = [
      meta({ url: 'https://atacante.example/' }),
      meta({ url: 'http://jesus.invalid/' }),
      meta({ url: 'https://jesus.invalid:8443/' }),
      meta({ url: 'https://u:p@jesus.invalid/' }),
      meta({ method: 'PUT' }),
      meta({ method: 'get' }),
      meta({ body: new Uint8Array([1]) }),
      meta({ method: 'POST', body: new Uint8Array(MAX_REQUEST_BODY_BYTES + 1) }),
      meta({ method: 'POST', body: 'texto' }),
      { ...meta(), extra: true },
    ];
    for (const item of bad) expect(parseToServer({ type: 'request', meta: item }), JSON.stringify(item).slice(0, 80)).toBeNull();
  });

  it('cabeçalhos: nome válido, valor sem quebra de linha, quantidade limitada', () => {
    const withHeaders = (headers: unknown) => parseToServer({ type: 'request', meta: meta({ headers }) });
    expect(withHeaders([['x-ok', 'valor']])).not.toBeNull();
    expect(withHeaders([['nome com espaço', 'v']])).toBeNull();
    expect(withHeaders([['x', 'a\r\nset-cookie: b=1']])).toBeNull();
    expect(withHeaders([['x', 'a\u0000b']])).toBeNull();
    expect(withHeaders([['x']])).toBeNull();
    expect(withHeaders(Array.from({ length: MAX_HEADERS + 1 }, (_, i) => [`x-${String(i)}`, 'v']))).toBeNull();
    expect(withHeaders([['x', 'v'.repeat(16 * 1024 + 1)]])).toBeNull();
    expect(withHeaders({ accept: 'text/html' })).toBeNull();
  });

  it('sinal de vida: ping e pong só com o número de sequência', () => {
    expect(parseToServer({ type: 'ping', seq: 1 })).toEqual({ type: 'ping', seq: 1 });
    expect(parseFromServer({ type: 'pong', seq: 7 })).toEqual({ type: 'pong', seq: 7 });
    expect(parseToServer({ type: 'ping', seq: 0 })).toBeNull();
    expect(parseToServer({ type: 'ping', seq: 1.5 })).toBeNull();
    expect(parseToServer({ type: 'ping', seq: 1, extra: true })).toBeNull();
    expect(parseFromServer({ type: 'pong' })).toBeNull();
    expect(parseFromServer({ type: 'ping', seq: 1 })).toBeNull();
  });

  it('bloqueio e uso vindos do principal; confirmação do servidor', () => {
    expect(parseToServer({ type: 'lock', reason: 'os_locked', seq: 3 })).toEqual({ type: 'lock', reason: 'os_locked', seq: 3 });
    expect(parseToServer({ type: 'lock', reason: 'suspend', seq: 4 })?.type).toBe('lock');
    expect(parseToServer({ type: 'lock', reason: 'manual', seq: 1 })).toBeNull();
    expect(parseToServer({ type: 'lock', reason: 'os_locked' })).toBeNull();
    expect(parseToServer({ type: 'activity' })).toEqual({ type: 'activity' });
    expect(parseToServer({ type: 'activity', at: 1 })).toBeNull();
    expect(parseFromServer({ type: 'lock-ack', seq: 3 })).toEqual({ type: 'lock-ack', seq: 3 });
    expect(parseFromServer({ type: 'lock-ack', seq: 0 })).toBeNull();
  });

  it('configuração: tempo sem uso só dentro da faixa', () => {
    const config = { type: 'config', uiDir: '/app/ui', dataDir: '/dados' };
    expect(parseToServer({ ...config, idleMs: 3_000 })).toEqual({ ...config, idleMs: 3_000 });
    expect(parseToServer({ ...config, idleMs: 999 })).toBeNull();
    expect(parseToServer({ ...config, idleMs: 121 * 60_000 })).toBeNull();
  });

  it('mensagens do servidor: pronto, falha, e nada além disso', () => {
    expect(parseFromServer({ type: 'ready', prepareMs: 180 })).toEqual({ type: 'ready', prepareMs: 180 });
    expect(parseFromServer({ type: 'failed', message: 'erro' })?.type).toBe('failed');
    expect(parseFromServer({ type: 'ready', prepareMs: -1 })).toBeNull();
    expect(parseFromServer({ type: 'ready', prepareMs: 1, pid: 3 })).toBeNull();
    expect(parseFromServer({ type: 'failed', message: 'x'.repeat(4001) })).toBeNull();
    expect(parseFromServer({ type: 'request', meta: meta() })).toBeNull();
  });

  it('port do pedido: o principal só confirma ou cancela', () => {
    expect(parseRequestPortIn({ type: 'ack' })).toEqual({ type: 'ack' });
    expect(parseRequestPortIn({ type: 'cancel' })).toEqual({ type: 'cancel' });
    expect(parseRequestPortIn({ type: 'ack', credits: 100 })).toBeNull();
    expect(parseRequestPortIn({ type: 'chunk', chunk: new Uint8Array(1) })).toBeNull();
  });

  it('port do pedido: cabeçalho de resposta, pedaços e fim conferidos', () => {
    const head = { type: 'head', status: 200, statusText: 'OK', headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']] };
    expect(parseRequestPortOut(head)).toEqual(head);
    expect(parseRequestPortOut({ ...head, status: 101 })).toBeNull();
    expect(parseRequestPortOut({ ...head, status: 600 })).toBeNull();
    expect(parseRequestPortOut({ ...head, status: 200.5 })).toBeNull();
    expect(parseRequestPortOut({ ...head, statusText: 'OK\r\nx: 1' })).toBeNull();
    expect(parseRequestPortOut({ type: 'chunk', chunk: new Uint8Array(MAX_CHUNK_BYTES) })).not.toBeNull();
    expect(parseRequestPortOut({ type: 'chunk', chunk: new Uint8Array(MAX_CHUNK_BYTES + 1) })).toBeNull();
    expect(parseRequestPortOut({ type: 'chunk', chunk: new Uint8Array(0) })).toBeNull();
    expect(parseRequestPortOut({ type: 'chunk', chunk: [1, 2, 3] })).toBeNull();
    expect(parseRequestPortOut({ type: 'end' })).toEqual({ type: 'end' });
    expect(parseRequestPortOut({ type: 'error', message: 'detalhe' })).toBeNull();
  });
});
