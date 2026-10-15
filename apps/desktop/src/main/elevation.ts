import { execFile } from 'node:child_process';
import { join } from 'node:path';

/**
 * O Jesus nunca roda como administrador (invariante 6). No Windows, o nível de integridade do processo diz se ele foi
 * aberto elevado: "Alto" (S-1-16-12288) ou "Sistema" (S-1-16-16384). O `whoami` vem da pasta do sistema, por caminho
 * completo (nada de procurar no PATH). Se a conferência falhar, o app não abre (falha fechada).
 */

const ELEVATED_LEVELS = ['S-1-16-12288', 'S-1-16-16384'];
const MEDIUM_OR_LOWER = ['S-1-16-8192', 'S-1-16-8448', 'S-1-16-4096', 'S-1-16-0'];

export type ElevationCheck = 'elevated' | 'not-elevated' | 'unknown';

/** Lê a saída de `whoami /groups /fo csv /nh`. */
export function elevationFromWhoami(output: string): ElevationCheck {
  if (ELEVATED_LEVELS.some((sid) => output.includes(`"${sid}"`))) return 'elevated';
  if (MEDIUM_OR_LOWER.some((sid) => output.includes(`"${sid}"`))) return 'not-elevated';
  return 'unknown';
}

export function checkElevation(systemRoot: string | undefined): Promise<ElevationCheck> {
  if (systemRoot === undefined || systemRoot === '') return Promise.resolve('unknown');
  const whoami = join(systemRoot, 'System32', 'whoami.exe');
  return new Promise((resolve) => {
    execFile(whoami, ['/groups', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5_000, env: { SystemRoot: systemRoot } }, (error, stdout) => {
      resolve(error === null ? elevationFromWhoami(stdout) : 'unknown');
    });
  });
}
