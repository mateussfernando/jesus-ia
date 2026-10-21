import { parsePath } from '@jesus/gate';
import type { PathPlatform } from '@jesus/gate';
import type { PlacesInput } from '../bridge/executor-protocol';

/**
 * Os lugares do sistema que o Porteiro conhece (decisões 0021 e 0026), montados pelo principal com o que o Electron e o
 * ambiente informam. Cada um vira caminho real (`realpath` nativo: a pasta do usuário pode ser uma junção para outro
 * disco), conferido pelo texto; o que não existe fica como veio, e o que não passa no Porteiro fica de fora. Sem a pasta
 * do usuário e as de dados, nada funciona (erro).
 */

export interface PlaceSources {
  readonly home: string;
  readonly localAppData: string;
  readonly roamingAppData: string;
  readonly systemRoot?: string | undefined;
  /** Documentos, Downloads, Área de Trabalho, Imagens, Vídeos, Música (o que o sistema souber). */
  readonly personal: readonly (string | undefined)[];
  /** Pastas do sistema e dos programas. */
  readonly system: readonly (string | undefined)[];
  /** Pastas do Jesus: a de dados e a da instalação. */
  readonly jesus: readonly (string | undefined)[];
}

/**
 * No Linux (testes e desenvolvimento), as pastas do sistema. Ficam de fora a pasta temporária (os testes usam) e a
 * `/root` (a pasta do usuário quando ele é o root, como no contêiner da nuvem).
 */
export const LINUX_SYSTEM_FOLDERS: readonly string[] = [
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib32',
  '/lib64',
  '/opt',
  '/proc',
  '/run',
  '/sbin',
  '/snap',
  '/srv',
  '/sys',
  '/usr',
  '/var',
];

/** As variáveis do Windows com as pastas dos programas. */
export function windowsSystemFolders(env: NodeJS.ProcessEnv): (string | undefined)[] {
  return ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles', 'CommonProgramFiles(x86)'].map(
    (name) => env[name],
  );
}

export function buildPlaces(sources: PlaceSources, platform: PathPlatform, realpath: (path: string) => string | null): PlacesInput {
  const real = (path: string | undefined): string | null => {
    if (path === undefined || path === '') return null;
    const parsed = parsePath(realpath(path) ?? path, platform);
    return parsed.ok ? parsed.path.text : null;
  };
  const required = (name: string, path: string): string => {
    const resolved = real(path);
    if (resolved === null) throw new Error(`lugar do sistema inválido: ${name}`);
    return resolved;
  };
  const list = (paths: readonly (string | undefined)[]): string[] => [...new Set(paths.map(real).filter((path): path is string => path !== null))];
  const systemRoot = real(sources.systemRoot);
  return {
    home: required('home', sources.home),
    localAppData: required('localAppData', sources.localAppData),
    roamingAppData: required('roamingAppData', sources.roamingAppData),
    ...(systemRoot === null ? {} : { systemRoot }),
    personal: list(sources.personal),
    system: list(sources.system),
    jesus: list(sources.jesus),
  };
}
