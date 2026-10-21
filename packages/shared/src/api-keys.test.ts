import { describe, expect, it } from 'vitest';
import { checkAnthropicKey } from './api-keys';

// Chaves falsas, montadas por partes (nenhum padrão de token inteiro no código-fonte).
const key = (kind: string, body = 'q7Lm2Xv9Rt4Kp8Zw3Nd6Hs1Bf5Gy0Jcu_-AbCd') => ['sk-', 'ant-', kind, '-', body].join('');

describe('chave da API da Anthropic', () => {
  it('aceita a chave de API comum (com espaços em volta tirados)', () => {
    expect(checkAnthropicKey(key('api03'))).toEqual({ ok: true, key: key('api03') });
    expect(checkAnthropicKey(`  ${key('api04')}\n`)).toEqual({ ok: true, key: key('api04') });
  });

  it('recusa a chave de administrador, que gerencia a organização inteira', () => {
    expect(checkAnthropicKey(key('admin01'))).toEqual({ ok: false, reason: 'admin' });
    expect(checkAnthropicKey(key('ADMIN01'))).toEqual({ ok: false, reason: 'admin' });
  });

  it('recusa o que não tem a forma de chave de API', () => {
    for (const input of ['', 'sk-ant-', key('api03', 'curta'), key('oat01'), `${key('api03')} extra`, key('api03', 'com espaço no meio aqui 1234567')]) {
      expect(checkAnthropicKey(input), input).toEqual({ ok: false, reason: 'format' });
    }
  });
});
