import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O Jesus nunca roda como administrador (invariante 6). No Windows, o nível de integridade do processo diz se ele foi
 * aberto elevado: "Alto" (S-1-16-12288) ou "Sistema" (S-1-16-16384). O `whoami` vem da pasta do sistema, por caminho
 * completo (nada de procurar no PATH). Se a conferência falhar, o app não abre (falha fechada).
 */

/**
 * Pasta do sistema pelo link simbólico do núcleo (`\SystemRoot`, alcançado por `\\?\GLOBALROOT`), resolvida para o
 * caminho de verdade (`C:\Windows\System32`). Não vem da variável `SystemRoot`: o usuário pode redefinir variáveis do
 * sistema (HKCU\Environment), e o Jesus aberto como administrador rodaria elevado o `whoami` que ele escolhesse.
 */
const KERNEL_SYSTEM32 = '\\\\?\\GLOBALROOT\\SystemRoot\\System32';

/** Caminho do `whoami.exe` do sistema; `undefined` se não der para resolver (fora do Windows, por exemplo). */
export function systemWhoamiPath(kernelSystem32: string = KERNEL_SYSTEM32): string | undefined {
  try {
    return join(realpathSync.native(kernelSystem32), 'whoami.exe');
  } catch {
    return undefined;
  }
}

const ELEVATED_LEVELS = ['S-1-16-12288', 'S-1-16-16384'];
const MEDIUM_OR_LOWER = ['S-1-16-8192', 'S-1-16-8448', 'S-1-16-4096', 'S-1-16-0'];

export type ElevationCheck = 'elevated' | 'not-elevated' | 'unknown';

/** Lê a saída de `whoami /groups /fo csv /nh`. */
export function elevationFromWhoami(output: string): ElevationCheck {
  if (ELEVATED_LEVELS.some((sid) => output.includes(`"${sid}"`))) return 'elevated';
  if (MEDIUM_OR_LOWER.some((sid) => output.includes(`"${sid}"`))) return 'not-elevated';
  return 'unknown';
}

export function checkElevation(whoami: string | undefined): Promise<ElevationCheck> {
  if (whoami === undefined || whoami === '') return Promise.resolve('unknown');
  return new Promise((resolve) => {
    // Ambiente vazio: o libuv só completa as variáveis essenciais do Windows (as mesmas do processo).
    execFile(whoami, ['/groups', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5_000, env: {} }, (error, stdout) => {
      resolve(error === null ? elevationFromWhoami(stdout) : 'unknown');
    });
  });
}
