/**
 * JSON canônico (rascunho de login, revisão 2; decisão 0022): o mesmo valor dá sempre os mesmos bytes, em qualquer
 * processo. Serve ao hash do cartão de confirmação, às aprovações de ação e ao encadeamento do registro de auditoria.
 * - objetos: só objetos simples; chaves em NFC e em ordem crescente de ponto de código (não de unidade UTF-16), sem
 *   espaços; propriedade `undefined` fica de fora;
 * - arrays na ordem dada (`undefined` dentro de array lança erro: não há como omitir sem mudar as posições);
 * - strings em NFC, escapadas como no `JSON.stringify`;
 * - números: só inteiros seguros (fração, `NaN`, infinito ou inteiro inseguro lançam erro); `-0` sai como `0`;
 * - `true`, `false` e `null` como no JSON;
 * - qualquer outra coisa (bigint, função, símbolo, data, mapa, instância de classe, ciclo) lança erro.
 */

const MAX_DEPTH = 64;

export class CanonicalJsonError extends Error {
  override readonly name = 'CanonicalJsonError';
}

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const difference = (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encode(value: unknown, path: string, depth: number, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'number':
      if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(`número que não é inteiro seguro em ${path}`);
      return Object.is(value, -0) ? '0' : String(value);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`tipo ${typeof value} não aceito em ${path}`);
  }
  if (depth >= MAX_DEPTH) throw new CanonicalJsonError(`profundidade acima de ${String(MAX_DEPTH)} em ${path}`);
  if (seen.has(value)) throw new CanonicalJsonError(`ciclo em ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((item: unknown, index) => {
        if (item === undefined) throw new CanonicalJsonError(`undefined dentro de array em ${path}[${String(index)}]`);
        return encode(item, `${path}[${String(index)}]`, depth + 1, seen);
      });
      return `[${items.join(',')}]`;
    }
    if (!isPlainObject(value)) throw new CanonicalJsonError(`objeto que não é simples em ${path}`);
    const entries = new Map<string, unknown>();
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      const normalized = key.normalize('NFC');
      if (entries.has(normalized)) throw new CanonicalJsonError(`chaves iguais depois da NFC em ${path}: ${JSON.stringify(normalized)}`);
      entries.set(normalized, item);
    }
    const keys = [...entries.keys()].sort(compareCodePoints);
    const members = keys.map((key) => `${JSON.stringify(key)}:${encode(entries.get(key), `${path}.${key}`, depth + 1, seen)}`);
    return `{${members.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new CanonicalJsonError('undefined não tem forma canônica');
  return encode(value, '$', 0, new Set());
}
