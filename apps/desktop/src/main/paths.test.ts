import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appPaths } from './paths';

describe('caminhos do app', () => {
  it('produção: pasta Jesus em appData; interface e servidor ao lado do bundle', () => {
    const paths = appPaths({ appData: '/home/u/.config', bundleDir: '/app/resources/app.asar/dist', testBuild: false });
    expect(paths).toEqual({
      userData: join('/home/u/.config', 'Jesus'),
      dataDir: join('/home/u/.config', 'Jesus', 'data'),
      uiDir: join('/app/resources/app.asar', 'stage', 'ui', 'apps', 'ui'),
      nextHostEntry: join('/app/resources/app.asar/dist', 'next-host.mjs'),
    });
  });

  it('o build de produção ignora a pasta dos testes', () => {
    const paths = appPaths({ appData: '/c', bundleDir: '/b/dist', testBuild: false, e2eUserData: '/tmp/e2e' });
    expect(paths.userData).toBe(join('/c', 'Jesus'));
  });

  it('o build de teste nunca usa a pasta do app de verdade', () => {
    expect(appPaths({ appData: '/c', bundleDir: '/b/dist', testBuild: true }).userData).toBe(join('/c', 'Jesus (teste)'));
    expect(appPaths({ appData: '/c', bundleDir: '/b/dist', testBuild: true, e2eUserData: '/tmp/e2e' }).userData).toBe('/tmp/e2e');
    expect(() => appPaths({ appData: '/c', bundleDir: '/b/dist', testBuild: true, e2eUserData: 'relativo' })).toThrow();
  });
});
