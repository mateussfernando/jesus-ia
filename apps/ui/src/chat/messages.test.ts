import { CHAT_FAILURES } from '@jesus/core/chat';
import { describe, expect, it } from 'vitest';
import { contextUsage, noticeFor } from './messages';

describe('mensagens da conversa', () => {
  it('todo motivo de falha tem uma mensagem própria; só Parar é aviso, o resto é erro', () => {
    const texts = new Set<string>();
    for (const reason of CHAT_FAILURES) {
      const notice = noticeFor(reason);
      expect(notice.text.length, reason).toBeGreaterThan(10);
      expect(notice.tone, reason).toBe(reason === 'cancelled' ? 'info' : 'error');
      texts.add(notice.text);
    }
    expect(texts.size).toBe(CHAT_FAILURES.length);
  });

  it('quem precisa ir às Configurações é mandado para lá', () => {
    for (const reason of ['no_key', 'vault', 'over_budget', 'api_auth'] as const) expect(noticeFor(reason).text).toContain('Configurações');
    for (const reason of ['context_full', 'too_large'] as const) expect(noticeFor(reason).text).toContain('conversa nova');
  });

  it('uso do limite, arredondado para baixo e sem passar de 100%', () => {
    expect(contextUsage(0, 88_500)).toBe('Conversa: 0% do limite');
    expect(contextUsage(170, 88_500)).toBe('Conversa: menos de 1% do limite');
    expect(contextUsage(44_250, 88_500)).toBe('Conversa: 50% do limite');
    expect(contextUsage(88_499, 88_500)).toBe('Conversa: 99% do limite');
    expect(contextUsage(95_000, 88_500)).toBe('Conversa: 100% do limite');
    expect(contextUsage(1, 0)).toBe('');
  });
});
