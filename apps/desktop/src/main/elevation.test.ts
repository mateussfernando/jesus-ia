import { describe, expect, it } from 'vitest';
import { checkElevation, elevationFromWhoami } from './elevation';

// Trechos reais de `whoami /groups /fo csv /nh` (o nível de integridade é a última linha).
const MEDIUM = '"Todos","Grupo conhecido","S-1-1-0","Grupo obrigatório"\r\n"Rótulo Obrigatório\\Nível Obrigatório Médio","Rótulo","S-1-16-8192",""\r\n';
const HIGH = '"BUILTIN\\Administradores","Alias","S-1-5-32-544","Proprietário"\r\n"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""\r\n';
const SYSTEM = '"Mandatory Label\\System Mandatory Level","Label","S-1-16-16384",""\r\n';

describe('conferência de administrador (Windows)', () => {
  it('lê o nível de integridade', () => {
    expect(elevationFromWhoami(MEDIUM)).toBe('not-elevated');
    expect(elevationFromWhoami(HIGH)).toBe('elevated');
    expect(elevationFromWhoami(SYSTEM)).toBe('elevated');
  });

  it('saída sem nível conhecido não passa (falha fechada)', () => {
    expect(elevationFromWhoami('')).toBe('unknown');
    expect(elevationFromWhoami('Acesso negado.')).toBe('unknown');
    // O SID solto no texto (fora do campo do CSV) não conta.
    expect(elevationFromWhoami('S-1-16-8192')).toBe('unknown');
  });

  it('sem a pasta do sistema, ou sem o whoami, o resultado é desconhecido', async () => {
    expect(await checkElevation(undefined)).toBe('unknown');
    expect(await checkElevation('/pasta/que/nao/existe')).toBe('unknown');
  });
});
