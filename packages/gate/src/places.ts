import { foldCase, isInside, joinPath, windowsPath } from './windows-path';
import type { WindowsPath } from './windows-path';

/**
 * Os lugares que as regras de leitura conhecem (decisão 0021): a pasta do usuário, as pastas de dados dos programas e
 * as pastas do próprio Jesus. Quem monta é o processo principal, com os caminhos do sistema; as regras não leem o
 * ambiente sozinhas.
 */

export interface GatePlacesInput {
  /** `%USERPROFILE%` (`C:\Users\Mateus`). */
  readonly home: string;
  /** `%LOCALAPPDATA%` e `%APPDATA%`. */
  readonly localAppData: string;
  readonly roamingAppData: string;
  /** `%SystemRoot%` (`C:\Windows`), quando se sabe. */
  readonly systemRoot?: string;
  /** Pastas do Jesus além das conhecidas (a pasta de dados e a da instalação de verdade, vistas pelo principal). */
  readonly jesus?: readonly string[];
}

export interface GatePlaces {
  readonly home: WindowsPath;
  readonly localAppData: WindowsPath;
  readonly roamingAppData: WindowsPath;
  readonly systemRoot: WindowsPath | null;
  /** Pastas do Jesus: dados (`%LOCALAPPDATA%\Jesus`, também a do build de teste) e instalação, e as que vierem. */
  readonly jesus: readonly WindowsPath[];
}

/** Pasta de desenvolvimento da interface (`apps/ui/.jesus-dev`, com a senha local): negada em qualquer lugar. */
export const JESUS_DEV_DIR = '.jesus-dev';

export function createPlaces(input: GatePlacesInput): GatePlaces {
  const localAppData = windowsPath(input.localAppData);
  return {
    home: windowsPath(input.home),
    localAppData,
    roamingAppData: windowsPath(input.roamingAppData),
    systemRoot: input.systemRoot === undefined ? null : windowsPath(input.systemRoot),
    jesus: Object.freeze([
      joinPath(localAppData, 'Jesus'),
      joinPath(localAppData, 'Jesus (teste)'),
      joinPath(localAppData, 'Programs', 'Jesus'),
      ...(input.jesus ?? []).map(windowsPath),
    ]),
  };
}

const JESUS_DEV_FOLDED = foldCase(JESUS_DEV_DIR);

/** O caminho é (ou fica dentro de) uma pasta do Jesus. */
export function isJesusPath(path: WindowsPath, places: GatePlaces): boolean {
  return places.jesus.some((place) => isInside(path, place)) || path.folded.includes(JESUS_DEV_FOLDED);
}
