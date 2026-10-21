import { foldCase, hostPath, isInside, joinPath } from './path';
import type { GatePath, PathPlatform } from './path';

/**
 * Os lugares que as regras conhecem (decisão 0021): a pasta do usuário, as pastas de dados dos programas, as pastas
 * pessoais, as do sistema e as do próprio Jesus. Quem monta é o processo principal, com os caminhos do sistema; as
 * regras não leem o ambiente sozinhas.
 */

export interface GatePlacesInput {
  /** `%USERPROFILE%` (`C:\Users\Mateus`). */
  readonly home: string;
  /** `%LOCALAPPDATA%` e `%APPDATA%` (no Linux, as duas são `~/.config`, onde o Electron guarda os dados). */
  readonly localAppData: string;
  readonly roamingAppData: string;
  /** `%SystemRoot%` (`C:\Windows`), quando se sabe. */
  readonly systemRoot?: string | undefined;
  /** Pastas do Jesus além das conhecidas (a pasta de dados e a da instalação de verdade, vistas pelo principal). */
  readonly jesus?: readonly string[] | undefined;
  /** Pastas pessoais (Documentos, Downloads, Área de Trabalho, Imagens, Vídeos, Música): não são liberadas inteiras. */
  readonly personal?: readonly string[] | undefined;
  /** Pastas do sistema (Arquivos de Programas, ProgramData; no Linux, `/etc`, `/usr`…): nunca liberadas. */
  readonly system?: readonly string[] | undefined;
}

export interface GatePlaces {
  readonly platform: PathPlatform;
  readonly home: GatePath;
  readonly localAppData: GatePath;
  readonly roamingAppData: GatePath;
  readonly systemRoot: GatePath | null;
  /** Pastas do Jesus: dados (`%LOCALAPPDATA%\Jesus`, também a do build de teste) e instalação, e as que vierem. */
  readonly jesus: readonly GatePath[];
  readonly personal: readonly GatePath[];
  /** Pastas do sistema, com a `systemRoot`. */
  readonly system: readonly GatePath[];
}

/** Pasta de desenvolvimento da interface (`apps/ui/.jesus-dev`, com a senha local): negada em qualquer lugar. */
export const JESUS_DEV_DIR = '.jesus-dev';

export function createPlaces(input: GatePlacesInput, platform: PathPlatform = 'win32'): GatePlaces {
  const path = (text: string) => hostPath(text, platform);
  const localAppData = path(input.localAppData);
  const systemRoot = input.systemRoot === undefined ? null : path(input.systemRoot);
  return {
    platform,
    home: path(input.home),
    localAppData,
    roamingAppData: path(input.roamingAppData),
    systemRoot,
    jesus: Object.freeze([
      joinPath(localAppData, 'Jesus'),
      joinPath(localAppData, 'Jesus (teste)'),
      joinPath(localAppData, 'Programs', 'Jesus'),
      ...(input.jesus ?? []).map(path),
    ]),
    personal: Object.freeze((input.personal ?? []).map(path)),
    system: Object.freeze([...(systemRoot === null ? [] : [systemRoot]), ...(input.system ?? []).map(path)]),
  };
}

const JESUS_DEV_FOLDED = foldCase(JESUS_DEV_DIR);

/** O caminho é (ou fica dentro de) uma pasta do Jesus. */
export function isJesusPath(path: GatePath, places: GatePlaces): boolean {
  return places.jesus.some((place) => isInside(path, place)) || path.upper.includes(JESUS_DEV_FOLDED);
}
