import { describe, expect, it } from 'vitest';
import { SseUsageReader } from './sse-usage';

const encoder = new TextEncoder();

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const START = event('message_start', {
  type: 'message_start',
  message: {
    id: 'msg_1',
    model: 'claude-haiku-5-5',
    usage: { input_tokens: 120, cache_creation_input_tokens: 800, cache_read_input_tokens: 4000, output_tokens: 1 },
  },
});
const TEXT = event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá, ação ✓' } });
const DELTA = event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 57 } });
const STOP = event('message_stop', { type: 'message_stop' });

function read(chunks: (string | Uint8Array)[]) {
  const reader = new SseUsageReader();
  for (const chunk of chunks) reader.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
  reader.end();
  return reader.result;
}

describe('SseUsageReader', () => {
  it('soma a entrada do message_start com a saída final do message_delta', () => {
    const result = read([START, TEXT, DELTA, STOP]);
    expect(result).toEqual({
      raw: { input_tokens: 120, cache_creation_input_tokens: 800, cache_read_input_tokens: 4000, output_tokens: 57 },
      final: true,
      streamError: null,
      broken: false,
    });
  });

  it('o message_delta com os campos todos vale por inteiro (já vem somado)', () => {
    const delta = event('message_delta', {
      type: 'message_delta',
      usage: { input_tokens: 130, cache_creation_input_tokens: 0, cache_read_input_tokens: 4800, output_tokens: 9, cache_creation: { ephemeral_5m_input_tokens: 0 } },
    });
    expect(read([START, delta]).raw).toEqual({
      input_tokens: 130,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 4800,
      output_tokens: 9,
      cache_creation: { ephemeral_5m_input_tokens: 0 },
    });
  });

  it('linhas e caracteres de vários bytes partidos entre pedaços', () => {
    const whole = encoder.encode(START + TEXT + DELTA + STOP);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < whole.length; offset += 7) chunks.push(whole.subarray(offset, offset + 7));
    expect(read(chunks).raw?.['output_tokens']).toBe(57);
  });

  it('aceita \\r\\n no fim das linhas', () => {
    expect(read([(START + DELTA).replaceAll('\n', '\r\n')]).final).toBe(true);
  });

  it('sem message_delta, o uso fica sem a saída final', () => {
    const result = read([START, TEXT]);
    expect(result.final).toBe(false);
    expect(result.raw?.['output_tokens']).toBe(1);
  });

  it('evento de erro no meio da resposta fica anotado', () => {
    const error = event('error', { type: 'error', error: { type: 'overloaded_error', message: 'x' } });
    expect(read([START, error]).streamError).toBe('overloaded_error');
  });

  it('desiste com JSON inválido, message_start repetido ou message_delta antes do começo', () => {
    expect(read([START, 'data: {quebrado\n\n']).broken).toBe(true);
    expect(read([START, START]).broken).toBe(true);
    expect(read([DELTA]).broken).toBe(true);
  });

  it('desiste com linha grande demais, inteira ou em pedaços', () => {
    const huge = `data: "${'x'.repeat(1024 * 1024)}"\n`;
    expect(read([START, huge]).broken).toBe(true);
    const partial = new SseUsageReader();
    partial.push(encoder.encode(START));
    partial.push(encoder.encode(`data: "${'x'.repeat(1024 * 1024 + 10)}`));
    expect(partial.result.broken).toBe(true);
  });

  it('ignora o que não é data: (comentários, event:, ping)', () => {
    const result = read([': comentário\n', 'event: ping\ndata: {"type":"ping"}\n\n', START, DELTA]);
    expect(result.broken).toBe(false);
    expect(result.final).toBe(true);
  });
});
