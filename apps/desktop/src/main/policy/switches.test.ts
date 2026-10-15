import { describe, expect, it } from 'vitest';
import { APP_DISABLED_FEATURES, mergeFeatureList, unexpectedArguments } from './switches';

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

  it('junta as listas de recursos num valor só, sem repetição nem lixo', () => {
    expect(mergeFeatureList(APP_DISABLED_FEATURES, ['Outro', 'WebRtcHideLocalIpsWithMdns'], ['com,virgula', 'x y'])).toBe(
      'WebRtcHideLocalIpsWithMdns,Outro',
    );
  });
});
