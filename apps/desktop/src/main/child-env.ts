/**
 * Ambiente dos processos filhos (utilityProcess do Next, do Cérebro e do Executor): montado por lista, nunca herdado
 * inteiro (seção 3.0, invariantes 8 e 9; seção 3.5). Nada de chave de API, token, URL de banco ou opção do Node/Electron
 * que mude o comportamento do processo.
 *
 * No Windows, os nomes de variável não diferenciam maiúsculas (`Path` e `PATH` são a mesma), e o `process.env` devolve
 * a grafia original. Por isso a comparação é sempre sem maiúsculas: uma lista com comparação exata perderia o `Path`
 * e deixaria passar `anthropic_api_key`.
 */

/** Variáveis do sistema que um processo filho precisa para funcionar (pastas, idioma, fuso). */
export const BASE_ENV_ALLOW: readonly string[] = [
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'HOME',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMDATA',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'TZ',
];

/** Nunca passam, nem que alguém as ponha na lista: segredos e opções que mudam o runtime. */
const HARD_DENY: readonly RegExp[] = [
  /^ANTHROPIC_/i,
  /^AI_GATEWAY_/i,
  /^OPENAI_/i,
  /^VERCEL_/i,
  /^AWS_/i,
  /^AZURE_/i,
  /^GOOGLE_/i,
  /^GITHUB_/i,
  /^GH_/i,
  /^NPM_/i,
  /^ELECTRON_/i,
  /^NODE_(?!ENV$)/i,
  /^JESUS_DATABASE_URL$/i,
  /^DATABASE_URL$/i,
  /API_?KEY/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /^HTTPS?_PROXY$/i,
  /^ALL_PROXY$/i,
  /^SSL_CERT_/i,
];

export function isDeniedEnvName(name: string): boolean {
  return HARD_DENY.some((pattern) => pattern.test(name));
}

export interface ChildEnvOptions {
  /** Nomes a mais permitidos, além da lista base (comparados sem maiúsculas). */
  readonly allow?: readonly string[];
  /** Valores fixos postos pelo app (por exemplo `NODE_ENV=production`); vencem o que vier do ambiente. */
  readonly fixed?: Readonly<Record<string, string>>;
}

export function buildChildEnv(source: Readonly<Record<string, string | undefined>>, options: ChildEnvOptions = {}): Record<string, string> {
  const allow = new Set([...BASE_ENV_ALLOW, ...(options.allow ?? [])].map((name) => name.toUpperCase()));
  const fixed = options.fixed ?? {};
  for (const name of Object.keys(fixed)) {
    if (isDeniedEnvName(name)) throw new Error(`variável proibida no ambiente de um processo filho: ${name}`);
  }
  const fixedNames = new Set(Object.keys(fixed).map((name) => name.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!allow.has(upper) || fixedNames.has(upper) || isDeniedEnvName(name)) continue;
    env[name] = value;
  }
  return { ...env, ...fixed };
}
