import { describe, expect, it } from 'vitest';
import { messageFor, NO_VAULT } from './key-messages';

describe('mensagens da tela Configurações', () => {
  it('sucesso mostra o texto pedido; cada problema tem a sua explicação; nenhuma repete a chave', () => {
    expect(messageFor({ ok: true, anthropicKey: 'present' }, 'Chave guardada no cofre.')).toEqual({
      anthropicKey: 'present',
      ok: true,
      message: 'Chave guardada no cofre.',
    });
    expect(messageFor({ ok: false, anthropicKey: 'absent', problem: 'admin' }, '').message).toContain('administrador');
    expect(messageFor({ ok: false, anthropicKey: 'absent', problem: 'insecure_backend' }, '').message).toContain('chaveiro');
    expect(messageFor({ ok: false, anthropicKey: 'unknown' }, '').message).toContain('Tente de novo');
    expect(NO_VAULT.anthropicKey).toBe('no_vault');
  });
});
