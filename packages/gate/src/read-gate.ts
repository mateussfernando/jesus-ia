import { hostPath, isInside, parsePath } from './path';
import type { GatePath, PathPlatform, PathProblem } from './path';
import { createPlaces, isJesusPath } from './places';
import type { GatePlaces, GatePlacesInput } from './places';
import { sensitiveKind } from './sensitive';
import type { SensitiveKind } from './sensitive';

/**
 * Porteiro da leitura de arquivos na fase 1 (decisão 0021; seções 3.4.2 a 3.4.4). Determinístico e sem disco, em duas
 * conferências:
 * 1. **O caminho pedido** (`checkRequestedPath`), antes de o Executor tocar o disco: só pelo texto. Um caminho de rede
 *    nem chega a ser aberto (abrir já dispararia acesso à rede).
 * 2. **O caminho real** (`checkResolvedPath`), depois que o Executor abriu e resolveu links, junções e nomes curtos: o
 *    destino de verdade, o tipo (arquivo, pasta) e quantos nomes o arquivo tem.
 *
 * Em cada uma, a ordem é: pasta do Jesus → leitura sensível → fora das pastas liberadas. A negação vale se o caminho
 * pedido **ou** o real casar (como no Claude Code), e a liberação exige os dois dentro de uma pasta liberada. Na fase 1
 * não há confirmação para ler fora das pastas liberadas: nega (a pergunta da seção 3.4.4 chega com os cartões).
 */

export type EntryKind = 'file' | 'directory' | 'other';
export type Which = 'requested' | 'real';

export type ReadDenial =
  | { readonly reason: 'path'; readonly which: Which; readonly problem: PathProblem }
  | { readonly reason: 'jesus'; readonly which: Which }
  | { readonly reason: 'sensitive'; readonly which: Which; readonly kind: SensitiveKind }
  | { readonly reason: 'outside'; readonly which: Which }
  /** Pediu um arquivo e é pasta (ou o contrário), ou é outra coisa (dispositivo, pipe). */
  | { readonly reason: 'kind'; readonly expected: 'file' | 'directory'; readonly actual: EntryKind }
  /** Arquivo com mais de um nome: o mesmo conteúdo pode estar fora das pastas liberadas. */
  | { readonly reason: 'hardlink'; readonly links: number };

export type RequestedVerdict =
  | { readonly decision: 'allow'; readonly path: GatePath }
  | { readonly decision: 'deny'; readonly denial: ReadDenial };

export type ResolvedVerdict =
  | { readonly decision: 'allow'; readonly path: GatePath; readonly real: GatePath }
  | { readonly decision: 'deny'; readonly denial: ReadDenial };

/** O que o Executor viu no disco depois de abrir o caminho pedido. */
export interface ResolvedFacts {
  /** O caminho real (`realpath`), depois de links, junções e nomes curtos. */
  readonly real: string;
  readonly kind: EntryKind;
  /** Quantos nomes o arquivo tem (`nlink`). */
  readonly links: number;
}

export interface ReadPolicy {
  readonly platform: PathPlatform;
  /** Pastas liberadas pelo dono, já resolvidas (caminho real). */
  readonly released: readonly GatePath[];
  readonly places: GatePlaces;
}

export interface ReadPolicyInput {
  readonly released: readonly string[];
  readonly places: GatePlacesInput;
  /** Windows (o produto) ou POSIX (testes e desenvolvimento no Linux). */
  readonly platform?: PathPlatform;
}

export function createReadPolicy(input: ReadPolicyInput): ReadPolicy {
  const platform = input.platform ?? 'win32';
  return {
    platform,
    released: Object.freeze(input.released.map((text) => hostPath(text, platform))),
    places: createPlaces(input.places, platform),
  };
}

function classify(path: GatePath, which: Which, policy: ReadPolicy): ReadDenial | null {
  if (isJesusPath(path, policy.places)) return { reason: 'jesus', which };
  const kind = sensitiveKind(path, policy.places);
  if (kind !== null) return { reason: 'sensitive', which, kind };
  if (!policy.released.some((folder) => isInside(path, folder))) return { reason: 'outside', which };
  return null;
}

export function checkRequestedPath(requested: string, policy: ReadPolicy): RequestedVerdict {
  const parsed = parsePath(requested, policy.platform);
  if (!parsed.ok) return { decision: 'deny', denial: { reason: 'path', which: 'requested', problem: parsed.problem } };
  const denial = classify(parsed.path, 'requested', policy);
  return denial === null ? { decision: 'allow', path: parsed.path } : { decision: 'deny', denial };
}

/**
 * O caminho a que um link leva (o alvo do link junto com o resto do caminho pedido), conferido pelo texto antes de o
 * Executor seguir o link: as mesmas regras, como caminho real. Assim, um link para a rede (`\\servidor\pasta`, que no
 * Windows mandaria a credencial do usuário ao servidor), para um dispositivo ou para fora das pastas liberadas nem chega
 * a ser aberto.
 */
export function checkLinkTarget(target: string, policy: ReadPolicy): RequestedVerdict {
  const parsed = parsePath(target, policy.platform);
  if (!parsed.ok) return { decision: 'deny', denial: { reason: 'path', which: 'real', problem: parsed.problem } };
  const denial = classify(parsed.path, 'real', policy);
  return denial === null ? { decision: 'allow', path: parsed.path } : { decision: 'deny', denial };
}

export function checkResolvedPath(
  requested: GatePath,
  facts: ResolvedFacts,
  expected: 'file' | 'directory',
  policy: ReadPolicy,
): ResolvedVerdict {
  // O pedido de novo: a política pode ter mudado entre as duas conferências (uma pasta deixou de ser liberada).
  const again = classify(requested, 'requested', policy);
  if (again !== null) return { decision: 'deny', denial: again };
  const parsed = parsePath(facts.real, policy.platform);
  if (!parsed.ok) return { decision: 'deny', denial: { reason: 'path', which: 'real', problem: parsed.problem } };
  const denial = classify(parsed.path, 'real', policy);
  if (denial !== null) return { decision: 'deny', denial };
  if (facts.kind !== expected) return { decision: 'deny', denial: { reason: 'kind', expected, actual: facts.kind } };
  // Número de nomes que não faz sentido também nega (falha fechada).
  if (facts.kind === 'file' && (!Number.isSafeInteger(facts.links) || facts.links !== 1)) {
    return { decision: 'deny', denial: { reason: 'hardlink', links: facts.links } };
  }
  return { decision: 'allow', path: requested, real: parsed.path };
}
