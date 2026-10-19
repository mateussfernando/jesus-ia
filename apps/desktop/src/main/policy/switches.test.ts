import { describe, expect, it } from 'vitest';
import { APP_DISABLED_FEATURES, mergeFeatureList, unexpectedArguments, unexpectedEnvironment } from './switches';

const EXE = 'C:\\Users\\X\\AppData\\Local\\Programs\\Jesus\\Jesus.exe';

describe('linha de comando do app', () => {
  it('produção: abre só sem argumentos', () => {
    expect(unexpectedArguments([EXE], { testBuild: false })).toEqual([]);
  });

  it('produção: qualquer chave ou argumento faz o app sair', () => {
    for (const arg of [
      '--remote-debugging-port=9333',
      '--remote-debugging-pipe',
      '--remote-debugging-address=0.0.0.0',
      '--remote-allow-origins=*',
      '--inspect=9229',
      '--user-data-dir=C:\\temp',
      '--no-sandbox',
      '--disable-web-security',
      '--js-flags=--expose-gc',
      '--log-net-log=C:\\temp\\net.json',
      '--enable-logging',
      '--v=1',
      '--proxy-server=http://atacante:8080',
      '--host-resolver-rules=MAP * 1.2.3.4',
      '--disable-features=Foo',
      '--enable-features=Bar',
      'C:\\qualquer\\arquivo.txt',
    ]) {
      expect(unexpectedArguments([EXE, arg], { testBuild: false }), arg).toEqual([arg]);
    }
  });

  it('build de teste: aceita as chaves do Playwright', () => {
    expect(unexpectedArguments([EXE, '--remote-debugging-port=0', '--no-sandbox'], { testBuild: true })).toEqual([]);
  });

  it('produção: variáveis ELECTRON_* fazem o app sair (só os nomes, sem os valores)', () => {
    const env = {
      PATH: 'C:\\Windows',
      ELECTRON_DISABLE_SANDBOX: '1',
      electron_enable_logging: '1',
      Electron_Log_File: 'C:\\temp\\log.txt',
      ELECTRON_NO_ASAR: '1',
      ELECTRON_FORCE_IS_PACKAGED: '1',
      ELECTRON_QUALQUER_COISA_NOVA: 'segredo',
      NODE_OPTIONS: '--max-old-space-size=4096',
    };
    expect(unexpectedEnvironment(env, { testBuild: false })).toEqual([
      'ELECTRON_DISABLE_SANDBOX',
      'electron_enable_logging',
      'Electron_Log_File',
      'ELECTRON_NO_ASAR',
      'ELECTRON_FORCE_IS_PACKAGED',
      'ELECTRON_QUALQUER_COISA_NOVA',
    ]);
  });

  it('produção: aceita as variáveis sem efeito, as das ferramentas de build e o ambiente comum', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      ELECTRON_RUN_AS_NODE: '1',
      electron_no_attach_console: '1',
      ELECTRON_GET_USE_PROXY: '1',
      ELECTRON_MIRROR: 'https://espelho.example/',
      ELECTRON_BUILDER_CACHE: 'C:\\cache',
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
      XELECTRON_A: '1',
    };
    expect(unexpectedEnvironment(env, { testBuild: false })).toEqual([]);
  });

  it('build de teste: não confere o ambiente', () => {
    expect(unexpectedEnvironment({ ELECTRON_ENABLE_LOGGING: '1' }, { testBuild: true })).toEqual([]);
  });

  it('junta as listas de recursos num valor só, sem repetição nem lixo', () => {
    expect(mergeFeatureList(APP_DISABLED_FEATURES, ['Outro', 'WebRtcHideLocalIpsWithMdns'], ['com,virgula', 'x y'])).toBe(
      'WebRtcHideLocalIpsWithMdns,Outro',
    );
  });
});
