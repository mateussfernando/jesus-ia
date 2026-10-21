import { registerHooks } from 'node:module';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Só código de dentro do app carrega no servidor da interface (seção 3.13). A busca de módulos do Node sobe as pastas a
 * partir de quem pede: dentro do `app.asar`, um `require` que não acha o módulo lá dentro chega a
 * `<instalação>/resources/node_modules`, fora da integridade do asar (o Electron corta a busca só fora de
 * `resources`). O Next faz isso no começo: tenta `require('@opentelemetry/api')` antes da cópia embutida. Sem esta trava,
 * um arquivo deixado ali por qualquer programa do usuário rodaria a cada abertura dentro do `jesus-next`.
 */

/**
 * O módulo resolvido pode carregar: um módulo do Node (`node:`) ou um arquivo dentro da raiz do app. No Windows, o
 * sistema de arquivos não diferencia maiúsculas, e a comparação também não.
 */
export function isModuleInside(root: string, url: string, separator: string = sep): boolean {
  if (url.startsWith('node:')) return true;
  if (!url.startsWith('file:')) return false;
  const windows = separator === '\\';
  const fold = (text: string) => (windows ? text.toLowerCase() : text);
  const path = fold(fileURLToPath(url, { windows }));
  const base = fold(root.endsWith(separator) ? root : root + separator);
  return path === fold(root) || path.startsWith(base);
}

/**
 * Liga a trava para tudo o que carregar daqui em diante, por `require` ou `import`. `refuse` recusa também módulos de
 * dentro (no Cérebro, os de rede do Node).
 */
export function confineModules(root: string, refuse?: (specifier: string, url: string) => boolean): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!isModuleInside(root, resolved.url) || refuse?.(specifier, resolved.url) === true) {
        // O mesmo código do "não achei": quem tenta um módulo opcional (como o Next) segue com a cópia embutida.
        throw Object.assign(new Error(`módulo de fora do app recusado: ${specifier}`), { code: 'MODULE_NOT_FOUND' });
      }
      return resolved;
    },
  });
}
