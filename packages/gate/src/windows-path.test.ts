import { describe, expect, it } from 'vitest';
import { foldCase, isInside, joinPath, MAX_NAME_CHARS, MAX_PATH_CHARS, parseWindowsPath, windowsPath } from './windows-path';
import type { PathProblem } from './windows-path';

function problem(input: string): PathProblem | 'ok' {
  const parsed = parseWindowsPath(input);
  return parsed.ok ? 'ok' : parsed.problem;
}

describe('caminhos do Windows pelo texto', () => {
  it('normaliza barras, ., .., barras repetidas e a letra da unidade', () => {
    expect(windowsPath('c:/Users/Mateus/./Projetos//site/../site/index.html').text).toBe('C:\\Users\\Mateus\\Projetos\\site\\index.html');
    expect(windowsPath('C:\\').text).toBe('C:\\');
    expect(windowsPath('D:\\pasta\\').parts).toEqual(['pasta']);
  });

  it('.. acima da raiz fica na raiz, como no Windows', () => {
    expect(windowsPath('C:\\..\\..\\Windows').text).toBe('C:\\Windows');
  });

  it('compara sem diferenciar maiúsculas, nome a nome', () => {
    const folder = windowsPath('C:\\Users\\Mateus\\Projetos');
    expect(isInside(windowsPath('c:\\USERS\\mateus\\projetos\\a.txt'), folder)).toBe(true);
    expect(isInside(windowsPath('C:\\Users\\Mateus\\Projetos'), folder)).toBe(true);
    expect(isInside(windowsPath('C:\\Users\\Mateus\\ProjetosVelhos\\a.txt'), folder)).toBe(false);
    expect(isInside(windowsPath('C:\\Users\\Mateus'), folder)).toBe(false);
    expect(isInside(windowsPath('D:\\Users\\Mateus\\Projetos\\a.txt'), folder)).toBe(false);
  });

  it('dobra a caixa letra por letra (ß não vira SS, como no NTFS)', () => {
    expect(foldCase('Straße')).toBe('STRAßE');
    expect(foldCase('ação')).toBe('AÇÃO');
    expect(isInside(windowsPath('C:\\STRASSE\\a.txt'), windowsPath('C:\\Straße'))).toBe(false);
    expect(isInside(windowsPath('C:\\STRAßE\\a.txt'), windowsPath('C:\\straße'))).toBe(true);
  });

  it('recusa o que não é absoluto com unidade', () => {
    for (const input of ['pasta\\a.txt', 'a.txt', 'C:pasta\\a.txt', 'C:', '\\pasta\\a.txt', '~\\.ssh', '1:\\a', 'CC:\\a']) {
      expect(problem(input), input).toBe('not_absolute');
    }
  });

  it('recusa caminhos de rede e prefixos de dispositivo', () => {
    expect(problem('\\\\servidor\\pasta\\a.txt')).toBe('unc');
    expect(problem('//servidor/pasta/a.txt')).toBe('unc');
    expect(problem('\\\\localhost\\c$\\Users')).toBe('unc');
    for (const input of ['\\\\?\\C:\\a.txt', '//?/C:/a.txt', '\\\\.\\C:\\a.txt', '\\\\.\\PhysicalDrive0', '\\??\\C:\\a.txt', '\\\\?\\UNC\\srv\\x']) {
      expect(problem(input), input).toBe('device_namespace');
    }
  });

  it('recusa fluxos alternativos, caracteres inválidos e nomes terminados em ponto ou espaço', () => {
    expect(problem('C:\\pasta\\a.txt:escondido')).toBe('stream');
    expect(problem('C:\\pasta\\a.txt::$DATA')).toBe('stream');
    for (const input of ['C:\\pasta\\a*.txt', 'C:\\pasta\\a?.txt', 'C:\\pasta\\<a>.txt', 'C:\\pasta\\a|b', 'C:\\pasta\\"a"']) {
      expect(problem(input), input).toBe('invalid_char');
    }
    for (const input of ['C:\\pasta\\a.txt.', 'C:\\pasta\\a.txt ', 'C:\\pasta.\\a.txt', 'C:\\...\\a.txt', 'C:\\pasta\\   ']) {
      expect(problem(input), input).toBe('trailing_dot_space');
    }
  });

  it('recusa nomes de dispositivo, com ou sem extensão, em qualquer caixa', () => {
    for (const name of ['CON', 'nul', 'Aux', 'PRN', 'COM1', 'com9', 'LPT1', 'COM¹', 'LPT³', 'NUL.txt', 'con.tar.gz', 'CON .txt', 'CONIN$', 'conout$']) {
      expect(problem(`C:\\pasta\\${name}`), name).toBe('reserved_name');
    }
    for (const name of ['CONSOLE', 'nulo.txt', 'COM10', 'LPT', 'aux_', 'icon.png']) {
      expect(problem(`C:\\pasta\\${name}`), name).toBe('ok');
    }
  });

  it('recusa nomes curtos 8.3, que só o disco resolve', () => {
    for (const name of ['PROGRA~1', 'DOCUME~1', 'MATEUS~1', 'MICROS~1.NET', 'ABC~12.TXT', 'A~1']) {
      expect(problem(`C:\\${name}\\a.txt`), name).toBe('short_name');
    }
    for (const name of ['Backup~1.docx', 'notas~rascunho.txt', '~$documento.docx', 'arquivo~.txt', 'ABCDEFG~1']) {
      expect(problem(`C:\\pasta\\${name}`), name).toBe('ok');
    }
  });

  it('recusa controle e formatação invisível (direção do texto, largura zero) e surrogate solto', () => {
    for (const input of ['C:\\pasta\\a\u0000.txt', 'C:\\pasta\\a\n.txt', 'C:\\pasta\\a\u007F.txt', 'C:\\pasta\\fdp.\u202Etxt', 'C:\\pasta\\a\u200B.txt', 'C:\\\uFEFFpasta']) {
      expect(problem(input), JSON.stringify(input)).toBe('control_char');
    }
    expect(problem('C:\\pasta\\a\uD800.txt')).toBe('invalid_char');
    expect(problem('C:\\pasta\\emoji😀.txt')).toBe('ok');
  });

  it('confere até os nomes que um .. depois tira', () => {
    expect(problem('C:\\pasta\\a:b\\..\\c.txt')).toBe('stream');
    expect(problem('C:\\PROGRA~1\\..\\Users')).toBe('short_name');
  });

  it('tamanhos máximos', () => {
    expect(problem('')).toBe('empty');
    expect(problem(`C:\\${'a'.repeat(MAX_NAME_CHARS)}`)).toBe('ok');
    expect(problem(`C:\\${'a'.repeat(MAX_NAME_CHARS + 1)}`)).toBe('too_long');
    expect(problem(`C:\\${'a\\'.repeat(MAX_PATH_CHARS)}`)).toBe('too_long');
  });

  it('joinPath e windowsPath conferem como qualquer caminho', () => {
    expect(joinPath(windowsPath('C:\\Users\\Mateus'), 'AppData', 'Local').text).toBe('C:\\Users\\Mateus\\AppData\\Local');
    expect(() => joinPath(windowsPath('C:\\Users'), 'a:b')).toThrow();
    expect(() => windowsPath('relativo')).toThrow();
  });
});
