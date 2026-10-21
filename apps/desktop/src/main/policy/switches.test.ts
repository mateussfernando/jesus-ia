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

  it('produção: variáveis NODE_* fora da lista fazem o app sair', () => {
    const env = {
      PATH: 'C:\\Windows',
      NODE_DEBUG: 'https',
      node_debug_native: '*',
      Node_Compile_Cache: 'C:\\temp\\cache',
      NODE_V8_COVERAGE: 'C:\\temp\\cov',
      NODE_REDIRECT_WARNINGS: 'C:\\temp\\w.txt',
      NODE_ICU_DATA: 'C:\\temp\\icu',
      NODE_QUALQUER_COISA_NOVA: 'segredo',
    };
    expect(unexpectedEnvironment(env, { testBuild: false })).toEqual([
      'NODE_DEBUG',
      'node_debug_native',
      'Node_Compile_Cache',
      'NODE_V8_COVERAGE',
      'NODE_REDIRECT_WARNINGS',
      'NODE_ICU_DATA',
      'NODE_QUALQUER_COISA_NOVA',
    ]);
  });

  it('produção: aceita as NODE_* que não mudam nada no principal', () => {
    const env = {
      NODE_OPTIONS: '--max-old-space-size=4096',
      NODE_EXTRA_CA_CERTS: 'C:\\certs\\empresa.pem',
      node_use_system_ca: '1',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_USE_ENV_PROXY: '1',
      NODE_PATH: 'C:\\npm\\node_modules',
      NODE_ENV: 'development',
      NODE_NO_WARNINGS: '1',
      NODE_PENDING_DEPRECATION: '1',
      NODE_DISABLE_COLORS: '1',
      NODE: 'C:\\Program Files\\nodejs\\node.exe',
      XNODE_DEBUG: '1',
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
