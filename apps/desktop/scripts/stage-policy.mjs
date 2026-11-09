// Regras da montagem da interface para o app (decisão 0017): o que do build standalone do Next entra no pacote,
// o que sai em silêncio e o que faz a montagem falhar. Funções puras, testadas em stage-policy.test.mjs.

/** Saem em silêncio: otimização de imagem desligada (images.unoptimized), então o sharp e os binários dele sobram. */
const DROP_DIRS = [
  ['node_modules', 'sharp'],
  ['node_modules', '@img'],
];

/** Saem em silêncio: o app carrega o Next pela ponte; o server.js do standalone abriria uma porta. */
const DROP_FILES = new Set(['apps/ui/server.js']);

/** Pastas que nunca entram: a senha local do desenvolvimento e o git. */
const REFUSE_SEGMENTS = new Set(['.jesus-dev', '.git']);

/** Arquivos que nunca entram: variáveis de ambiente, credenciais, chaves e bancos. */
const REFUSE_BASENAMES = [
  /^\.env/i,
  /^\.npmrc$/i,
  /^credentials.*\.json$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|key|p12|pfx)$/i,
  /\.(db|sqlite|sqlite3)$/i,
];

/** Módulo nativo: só entra o que for revisado (decisão 0009); nenhum é esperado na interface. */
const NATIVE = /\.node$/i;

function segmentsOf(relativePath) {
  return relativePath.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.');
}

function containsSequence(segments, sequence) {
  for (let i = 0; i + sequence.length <= segments.length; i++) {
    if (sequence.every((part, j) => segments[i + j] === part)) return true;
  }
  return false;
}

/**
 * Classifica um caminho relativo à raiz do standalone (ou do destino): `keep`, `drop` (sai sem aviso) ou `refuse`
 * (a montagem falha e lista o arquivo). Pastas também passam por aqui: uma pasta `drop` não é nem percorrida.
 * @param {string} relativePath
 * @returns {'keep' | 'drop' | 'refuse'}
 */
export function classifyStagePath(relativePath) {
  const segments = segmentsOf(relativePath);
  if (segments.length === 0) return 'keep';
  if (DROP_FILES.has(segments.join('/'))) return 'drop';
  if (DROP_DIRS.some((sequence) => containsSequence(segments, sequence))) return 'drop';
  if (segments.some((segment) => REFUSE_SEGMENTS.has(segment.toLowerCase()))) return 'refuse';
  const base = segments.at(-1) ?? '';
  if (REFUSE_BASENAMES.some((pattern) => pattern.test(base))) return 'refuse';
  if (NATIVE.test(base)) return 'refuse';
  return 'keep';
}

/**
 * Um link simbólico só é seguido se o alvo real ficar dentro da raiz (o Turbopack cria links em
 * `.next/node_modules/<pacote>-<hash>` que apontam para o `node_modules` do próprio standalone).
 * @param {string} root caminho real da raiz
 * @param {string} target caminho real do alvo
 * @param {string} separator separador do sistema
 */
export function isInsideRoot(root, target, separator) {
  const base = root.endsWith(separator) ? root : root + separator;
  return target === root || target.startsWith(base);
}
