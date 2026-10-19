import { isAbsolute, join } from 'node:path';

/**
 * Onde o app guarda e acha as coisas. Os caminhos do pacote são relativos ao próprio bundle (`dist/main.mjs`), igual
 * no app instalado (dentro do `app.asar`) e no build de teste: `dist/` e `stage/` ficam lado a lado.
 */
export interface AppPaths {
  /** Pasta de dados do Electron (`%APPDATA%\Jesus`). Também define a trava de instância única. */
  readonly userData: string;
  /** Pasta de dados do Jesus (credencial da senha local, enquanto o PostgreSQL embutido não chega). */
  readonly dataDir: string;
  /** Pasta do build da interface (a que tem `.next/`). */
  readonly uiDir: string;
  /** Entrada do utilityProcess do servidor da interface. */
  readonly nextHostEntry: string;
}

export interface AppPathsOptions {
  /** `app.getPath('appData')`: `%APPDATA%` no Windows, `~/.config` no Linux. */
  readonly appData: string;
  /** Pasta do bundle do processo principal. */
  readonly bundleDir: string;
  readonly testBuild: boolean;
  /** Só no build de teste: pasta de dados própria de cada execução dos testes de ponta a ponta. */
  readonly e2eUserData?: string | undefined;
}

export const APP_NAME = 'Jesus';
/** O build de teste nunca usa a pasta do app de verdade (nem a senha do dono). */
export const TEST_APP_NAME = 'Jesus (teste)';
/** Identidade do app no Windows (a mesma do `electron-builder.config.cjs`); o build de teste tem a dele. */
export const APP_ID = 'dev.jesus.desktop';
export const TEST_APP_ID = 'dev.jesus.desktop.test';

export function appPaths(options: AppPathsOptions): AppPaths {
  let userData = join(options.appData, options.testBuild ? TEST_APP_NAME : APP_NAME);
  if (options.testBuild && options.e2eUserData !== undefined && options.e2eUserData !== '') {
    if (!isAbsolute(options.e2eUserData)) throw new Error('a pasta de dados dos testes precisa ser um caminho absoluto');
    userData = options.e2eUserData;
  }
  const appRoot = join(options.bundleDir, '..');
  return {
    userData,
    dataDir: join(userData, 'data'),
    uiDir: join(appRoot, 'stage', 'ui', 'apps', 'ui'),
    nextHostEntry: join(options.bundleDir, 'next-host.mjs'),
  };
}
