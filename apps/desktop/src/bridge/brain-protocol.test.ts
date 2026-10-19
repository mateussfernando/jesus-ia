import { describe, expect, it } from 'vitest';
import { MAX_API_BODY_BYTES, MAX_API_CHUNK_BYTES, parseFromBrain, parseToBrain } from './brain-protocol';

const request = {
  type: 'api-request',
  id: 1,
  url: 'https://api.anthropic.com/v1/messages',
  method: 'POST',
  headers: [['content-type', 'application/json']],
  body: '{}',
};

describe('protocolo da ponte com o Cérebro', () => {
  it('aceita as mensagens do Cérebro', () => {
    expect(parseFromBrain({ type: 'ready', prepareMs: 10 })).not.toBeNull();
    expect(parseFromBrain({ type: 'pong', seq: 3 })).not.toBeNull();
    expect(parseFromBrain({ type: 'failed', message: 'x' })).not.toBeNull();
    expect(parseFromBrain(request)).toEqual(request);
    expect(parseFromBrain({ type: 'api-cancel', id: 1 })).not.toBeNull();
  });

  it('recusa campo a mais, tipo errado e tamanhos fora do limite', () => {
    expect(parseFromBrain({ ...request, key: 'sk-ant' })).toBeNull();
    expect(parseFromBrain({ ...request, id: 0 })).toBeNull();
    expect(parseFromBrain({ ...request, id: 1.5 })).toBeNull();
    expect(parseFromBrain({ ...request, body: 'x'.repeat(MAX_API_BODY_BYTES + 1) })).toBeNull();
    expect(parseFromBrain({ ...request, headers: [['bad name', 'x']] })).toBeNull();
    expect(parseFromBrain({ ...request, headers: [['x', 'a\r\nb']] })).toBeNull();
    expect(parseFromBrain({ ...request, headers: Array.from({ length: 33 }, (_, i) => [`h${String(i)}`, 'x']) })).toBeNull();
    expect(parseFromBrain({ type: 'api-head', id: 1, status: 200, headers: [] })).toBeNull();
    expect(parseFromBrain({ type: 'vault', id: 1, op: 'status' })).toBeNull();
    expect(parseFromBrain('ready')).toBeNull();
  });

  it('aceita as mensagens do principal e recusa as fora do protocolo', () => {
    expect(parseToBrain({ type: 'ping', seq: 1 })).not.toBeNull();
    expect(parseToBrain({ type: 'api-head', id: 1, status: 200, headers: [['content-type', 'text/event-stream']] })).not.toBeNull();
    expect(parseToBrain({ type: 'api-chunk', id: 1, chunk: new Uint8Array([1]) })).not.toBeNull();
    expect(parseToBrain({ type: 'api-end', id: 1 })).not.toBeNull();
    expect(parseToBrain({ type: 'api-error', id: 1, reason: 'locked' })).not.toBeNull();

    expect(parseToBrain({ type: 'api-head', id: 1, status: 302, headers: [] })).toBeNull();
    expect(parseToBrain({ type: 'api-chunk', id: 1, chunk: new Uint8Array(0) })).toBeNull();
    expect(parseToBrain({ type: 'api-chunk', id: 1, chunk: new Uint8Array(MAX_API_CHUNK_BYTES + 1) })).toBeNull();
    expect(parseToBrain({ type: 'api-chunk', id: 1, chunk: 'texto' })).toBeNull();
    expect(parseToBrain({ type: 'api-error', id: 1, reason: 'qualquer' })).toBeNull();
    expect(parseToBrain({ type: 'api-end', id: 1, extra: true })).toBeNull();
  });
});
