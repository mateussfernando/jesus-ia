import { describe, expect, it } from 'vitest';
import { CHAT_FAILURES, EGRESS_FAILURES, isChatFailure } from './chat';

describe('vocabulário da conversa', () => {
  it('toda falha da saída para a API é também uma falha da conversa, sem repetição', () => {
    for (const failure of EGRESS_FAILURES) expect(CHAT_FAILURES).toContain(failure);
    expect(new Set(CHAT_FAILURES).size).toBe(CHAT_FAILURES.length);
  });

  it('isChatFailure aceita só os motivos da lista', () => {
    expect(isChatFailure('no_key')).toBe(true);
    expect(isChatFailure('context_full')).toBe(true);
    for (const value of ['qualquer', '', 'NO_KEY', 'toString', '__proto__', 1, null, undefined, {}]) {
      expect(isChatFailure(value), String(value)).toBe(false);
    }
  });
});
