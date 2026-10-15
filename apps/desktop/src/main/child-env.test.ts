import { describe, expect, it } from 'vitest';
import { buildChildEnv, isDeniedEnvName } from './child-env';

const APP_ENV = {
  Path: 'C:\\Windows\\system32',
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\X',
  LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local',
  ANTHROPIC_API_KEY: 'sk-ant-api03-segredo',
  anthropic_api_key: 'sk-ant-api03-segredo-minusculo',
  ANTHROPIC_BASE_URL: 'https://atacante.example',
  AI_GATEWAY_API_KEY: 'gw-segredo',
  JESUS_DATABASE_URL: 'postgresql://u:senha@h/db',
  NODE_OPTIONS: '--require=C:\\mal.js',
  ELECTRON_RUN_AS_NODE: '1',
  GITHUB_TOKEN: 'ghp_segredo',
  HTTPS_PROXY: 'http://atacante:8080',
  JESUS_FAKE_SECRET: 'nao-deve-passar',
  QUALQUER_OUTRA: 'x',
};

describe('ambiente dos processos filhos', () => {
  it('passa só a lista base, com a grafia original do Windows', () => {
    const env = buildChildEnv(APP_ENV);
    expect(env).toEqual({
      Path: 'C:\\Windows\\system32',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\X',
      LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local',
    });
  });

  it('nunca passa segredo nem opção do runtime, mesmo pedindo na lista', () => {
    const env = buildChildEnv(APP_ENV, {
      allow: ['ANTHROPIC_API_KEY', 'anthropic_api_key', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'JESUS_DATABASE_URL', 'GITHUB_TOKEN', 'HTTPS_PROXY'],
    });
    const text = JSON.stringify(env);
    expect(text).not.toContain('segredo');
    expect(text).not.toContain('atacante');
    expect(text).not.toContain('mal.js');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env).not.toHaveProperty('JESUS_DATABASE_URL');
  });

  it('valores fixos do app vencem o ambiente e não podem ser proibidos', () => {
    const env = buildChildEnv({ ...APP_ENV, NODE_ENV: 'development', node_env: 'test' }, {
      allow: ['NODE_ENV'],
      fixed: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    });
    expect(env['NODE_ENV']).toBe('production');
    expect(env).not.toHaveProperty('node_env');
    expect(env['NEXT_TELEMETRY_DISABLED']).toBe('1');
    expect(() => buildChildEnv(APP_ENV, { fixed: { ANTHROPIC_API_KEY: 'x' } })).toThrow();
  });

  it('a lista de negação reconhece variações de nome', () => {
    for (const name of ['MY_API_KEY', 'apikey', 'SERVICE_TOKEN', 'db_password', 'CLIENT_SECRET', 'Node_Options', 'electron_enable_logging']) {
      expect(isDeniedEnvName(name), name).toBe(true);
    }
    for (const name of ['PATH', 'TEMP', 'NODE_ENV', 'LANG']) expect(isDeniedEnvName(name), name).toBe(false);
  });
});
