import { describe, expect, it } from 'vitest';
import { isModuleInside } from './module-scope';

describe('trava de módulos do servidor da interface', () => {
  const root = '/opt/Jesus/resources/app.asar';
  // URL montada à mão: o `pathToFileURL` do Windows poria a letra da unidade num caminho POSIX.
  const inside = (path: string) => isModuleInside(root, `file://${path}`, '/');

  it('aceita arquivos dentro do app.asar e os módulos do Node', () => {
    expect(inside('/opt/Jesus/resources/app.asar/stage/ui/node_modules/next/dist/server/next.js')).toBe(true);
    expect(inside('/opt/Jesus/resources/app.asar/dist/next-host.mjs')).toBe(true);
    expect(isModuleInside(root, 'node:fs', '/')).toBe(true);
  });

  it('recusa o que está fora: resources/node_modules, vizinho com o mesmo começo, outros esquemas', () => {
    expect(inside('/opt/Jesus/resources/node_modules/@opentelemetry/api/index.js')).toBe(false);
    expect(inside('/opt/Jesus/resources/app.asar.unpacked/x.js')).toBe(false);
    expect(inside('/opt/Jesus/resources/app.asar2/x.js')).toBe(false);
    expect(inside('/node_modules/x/index.js')).toBe(false);
    expect(isModuleInside(root, 'data:text/javascript,export default 1', '/')).toBe(false);
    expect(isModuleInside(root, 'https://example.com/x.mjs', '/')).toBe(false);
  });

  it('caminhos do Windows (sem diferenciar maiúsculas, como o NTFS)', () => {
    const winRoot = 'C:\\Users\\X\\AppData\\Local\\Programs\\Jesus\\resources\\app.asar';
    expect(isModuleInside(winRoot, 'file:///C:/Users/X/AppData/Local/Programs/Jesus/resources/app.asar/stage/ui/node_modules/next/index.js', '\\')).toBe(true);
    expect(isModuleInside(winRoot, 'file:///c:/users/x/appdata/local/programs/jesus/resources/APP.ASAR/dist/next-host.mjs', '\\')).toBe(true);
    expect(isModuleInside(winRoot, 'file:///C:/Users/X/AppData/Local/Programs/Jesus/resources/node_modules/@opentelemetry/api/index.js', '\\')).toBe(false);
    expect(isModuleInside(winRoot, 'file:///C:/Users/X/AppData/Local/Programs/Jesus/resources/app.asar.unpacked/x.js', '\\')).toBe(false);
  });
});
