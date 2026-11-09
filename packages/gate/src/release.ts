import { isInside, parentPath, parsePath } from './path';
import type { GatePath, PathProblem } from './path';
import { isJesusPath } from './places';
import type { GatePlaces } from './places';
import type { ReadPolicy } from './read-gate';
import { sensitiveKind } from './sensitive';
import type { SensitiveKind } from './sensitive';

/**
 * Que pasta o dono pode liberar para leitura (decisão 0026; seção 3.4.7). Quem escolhe é ele, no diálogo do Windows; o
 * principal confere o caminho real escolhido antes da confirmação. Recusa:
 * - a raiz de uma unidade, a pasta do usuário e as acima dela;
 * - as pastas pessoais inteiras (Documentos, Downloads, Área de Trabalho, Imagens, Vídeos, Música) e as acima delas;
 *   uma subpasta delas (`Documentos\Projeto`) pode;
 * - as pastas de dados dos programas (`AppData`) e as do sistema, por dentro e as acima;
 * - as pastas do Jesus (por dentro e as que as contêm) e as sensíveis.
 */

export type ReleaseRefusal =
  | { readonly reason: 'path'; readonly problem: PathProblem }
  | { readonly reason: 'root' }
  | { readonly reason: 'jesus' }
  | { readonly reason: 'sensitive'; readonly kind: SensitiveKind }
  | { readonly reason: 'too_broad' }
  | { readonly reason: 'personal' }
  | { readonly reason: 'system' }
  | { readonly reason: 'app_data' };

export type ReleaseCheck = { readonly ok: true; readonly path: GatePath } | { readonly ok: false; readonly refusal: ReleaseRefusal };

/** `path` é `place` ou uma pasta acima dele. */
const contains = (path: GatePath, place: GatePath) => isInside(place, path);

/** As pastas de dados dos programas: `%LOCALAPPDATA%`, `%APPDATA%` e a `AppData` que as contém (com a `LocalLow`). */
function appDataPlaces(places: GatePlaces): readonly GatePath[] {
  const parent = parentPath(places.localAppData);
  const appData = parent !== null && parent.upper.at(-1) === 'APPDATA' ? [parent] : [];
  return [places.localAppData, places.roamingAppData, ...appData];
}

export function checkReleaseFolder(real: string, policy: ReadPolicy): ReleaseCheck {
  const refuse = (refusal: ReleaseRefusal): ReleaseCheck => ({ ok: false, refusal });
  const parsed = parsePath(real, policy.platform);
  if (!parsed.ok) return refuse({ reason: 'path', problem: parsed.problem });
  const path = parsed.path;
  const { places } = policy;
  // A ordem só escolhe o motivo mais claro: qualquer um recusa.
  if (path.parts.length === 0) return refuse({ reason: 'root' });
  if (contains(path, places.home)) return refuse({ reason: 'too_broad' });
  if (isJesusPath(path, places)) return refuse({ reason: 'jesus' });
  const kind = sensitiveKind(path, places);
  if (kind !== null) return refuse({ reason: 'sensitive', kind });
  if (appDataPlaces(places).some((place) => isInside(path, place) || contains(path, place))) return refuse({ reason: 'app_data' });
  if (places.system.some((place) => isInside(path, place) || contains(path, place))) return refuse({ reason: 'system' });
  if (places.personal.some((place) => contains(path, place))) return refuse({ reason: 'personal' });
  // Uma pasta que contém uma do Jesus (a de dados pode ficar fora do AppData).
  if (places.jesus.some((place) => contains(path, place))) return refuse({ reason: 'jesus' });
  return { ok: true, path };
}
