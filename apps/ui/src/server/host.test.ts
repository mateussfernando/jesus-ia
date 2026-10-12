import { describe, expect, it } from 'vitest';
import { hostnameOf, isAllowedRequestHost } from './host';

describe('hosts atendidos pelo servidor da interface', () => {
  it('aceita a própria máquina e o endereço interno do app, em qualquer porta', () => {
    for (const host of ['127.0.0.1:5173', 'localhost:5173', 'LOCALHOST:4000', '[::1]:5173', 'jesus.invalid', '127.0.0.1']) {
      expect(isAllowedRequestHost(host, null), host).toBe(true);
    }
  });

  it('recusa nomes de fora (DNS rebinding), cabeçalho ausente ou malformado', () => {
    for (const host of [
      'rebind.attacker.example:5173',
      '127.0.0.1.nip.io:5173',
      'localhost.attacker.example',
      'jesus.invalid.example',
      '',
      'localhost:5173 extra',
      'localhost:5173/x',
      'user@localhost:5173',
    ]) {
      expect(isAllowedRequestHost(host, null), host).toBe(false);
    }
    expect(isAllowedRequestHost(null, null)).toBe(false);
  });

  it('confere também o X-Forwarded-Host, que o Next usa para conferir a origem das ações', () => {
    expect(isAllowedRequestHost('127.0.0.1:5173', '127.0.0.1:5173')).toBe(true);
    expect(isAllowedRequestHost('127.0.0.1:5173', 'rebind.attacker.example')).toBe(false);
    expect(isAllowedRequestHost('127.0.0.1:5173', '')).toBe(false);
  });

  it('separa o nome da porta', () => {
    expect(hostnameOf('Localhost:5173')).toBe('localhost');
    expect(hostnameOf('[::1]:80')).toBe('[::1]');
    expect(hostnameOf('a b')).toBeNull();
  });
});
