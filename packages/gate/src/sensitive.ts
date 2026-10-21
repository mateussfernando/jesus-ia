import type { GatePlaces } from './places';
import { foldCase } from './windows-path';
import type { WindowsPath } from './windows-path';

/**
 * Leitura sensível, negada por padrão (seção 3.4.3), mesmo dentro de uma pasta liberada: chaves, credenciais, perfis
 * de navegador, cofres de senha, segredos do Windows, `.env` e carteiras. As regras olham o caminho pedido e o real
 * (depois de links e junções); qualquer um que case nega.
 */

export type SensitiveKind =
  /** Chaves e configuração do SSH e do GnuPG. */
  | 'ssh'
  /** Credenciais de nuvem e de ferramentas (AWS, Azure, Google Cloud, Kubernetes, Docker, git, npm, PyPI…). */
  | 'credentials'
  /** Perfis de navegador e de e-mail (cookies, senhas salvas, sessões). */
  | 'browser'
  /** Cofres de gerenciadores de senha. */
  | 'password_manager'
  /** Segredos do Windows: chaves do DPAPI, Gerenciador de Credenciais, registro do usuário e do sistema. */
  | 'windows'
  /** Chaves privadas e certificados com chave. */
  | 'private_key'
  /** `.env` e afins: o valor nunca vai para o modelo. */
  | 'env_file'
  /** Carteiras de criptomoeda. */
  | 'crypto_wallet'
  /** Sessões de aplicativos de conversa (quem tem os arquivos entra na conta). */
  | 'app_session';

type Folded = readonly string[];
const fold = (names: readonly string[]): Folded => names.map(foldCase);

/** Pastas que só guardam segredo, em qualquer lugar (um projeto com `.ssh` dentro também). */
const DIRECTORIES_ANYWHERE: ReadonlyMap<string, SensitiveKind> = new Map(
  (
    [
      ['.ssh', 'ssh'],
      ['.gnupg', 'ssh'],
      ['.aws', 'credentials'],
      ['.azure', 'credentials'],
      ['.kube', 'credentials'],
      ['.password-store', 'password_manager'],
    ] as const
  ).map(([name, kind]) => [foldCase(name), kind]),
);

/** Nomes de arquivo sensíveis em qualquer lugar. */
const FILE_NAMES: ReadonlyMap<string, SensitiveKind> = new Map(
  (
    [
      ['.env', 'env_file'],
      ['.envrc', 'env_file'],
      ['id_rsa', 'private_key'],
      ['id_dsa', 'private_key'],
      ['id_ecdsa', 'private_key'],
      ['id_ecdsa_sk', 'private_key'],
      ['id_ed25519', 'private_key'],
      ['id_ed25519_sk', 'private_key'],
      ['wallet.dat', 'crypto_wallet'],
    ] as const
  ).map(([name, kind]) => [foldCase(name), kind]),
);

const FILE_PATTERNS: readonly (readonly [RegExp, SensitiveKind])[] = [
  [/^\.env\./i, 'env_file'],
  [/\.(kdbx|kdb|psafe3|1pif|1pux|opvault)$/i, 'password_manager'],
  [/\.(pem|key|pfx|p12|ppk|jks|keystore)$/i, 'private_key'],
];

type Base = 'home' | 'localAppData' | 'roamingAppData' | 'systemRoot';

/** Lugares sensíveis a partir das pastas do usuário e do sistema. */
const UNDER: readonly (readonly [Base, Folded, SensitiveKind])[] = (
  [
    ['home', ['.config', 'gcloud'], 'credentials'],
    ['home', ['.docker', 'config.json'], 'credentials'],
    ['home', ['.git-credentials'], 'credentials'],
    ['home', ['.npmrc'], 'credentials'],
    ['home', ['.pypirc'], 'credentials'],
    ['home', ['.netrc'], 'credentials'],
    ['home', ['_netrc'], 'credentials'],
    ['home', ['.pgpass'], 'credentials'],
    ['localAppData', ['Google', 'Chrome', 'User Data'], 'browser'],
    ['localAppData', ['Google', 'Chrome Beta', 'User Data'], 'browser'],
    ['localAppData', ['Google', 'Chrome SxS', 'User Data'], 'browser'],
    ['localAppData', ['Chromium', 'User Data'], 'browser'],
    ['localAppData', ['Microsoft', 'Edge', 'User Data'], 'browser'],
    ['localAppData', ['Microsoft', 'Edge Beta', 'User Data'], 'browser'],
    ['localAppData', ['Microsoft', 'Edge Dev', 'User Data'], 'browser'],
    ['localAppData', ['BraveSoftware', 'Brave-Browser', 'User Data'], 'browser'],
    ['localAppData', ['Vivaldi', 'User Data'], 'browser'],
    ['localAppData', ['Yandex', 'YandexBrowser', 'User Data'], 'browser'],
    ['localAppData', ['Mozilla', 'Firefox', 'Profiles'], 'browser'],
    ['localAppData', ['Microsoft', 'Credentials'], 'windows'],
    ['localAppData', ['Microsoft', 'Vault'], 'windows'],
    ['localAppData', ['1Password'], 'password_manager'],
    ['roamingAppData', ['Mozilla', 'Firefox', 'Profiles'], 'browser'],
    ['roamingAppData', ['Opera Software'], 'browser'],
    ['roamingAppData', ['Thunderbird', 'Profiles'], 'browser'],
    ['roamingAppData', ['Microsoft', 'Protect'], 'windows'],
    ['roamingAppData', ['Microsoft', 'Credentials'], 'windows'],
    ['roamingAppData', ['Microsoft', 'Crypto'], 'windows'],
    ['roamingAppData', ['Microsoft', 'Vault'], 'windows'],
    ['roamingAppData', ['Microsoft', 'SystemCertificates'], 'windows'],
    ['roamingAppData', ['Bitwarden'], 'password_manager'],
    ['roamingAppData', ['Bitcoin'], 'crypto_wallet'],
    ['roamingAppData', ['Electrum'], 'crypto_wallet'],
    ['roamingAppData', ['Ethereum'], 'crypto_wallet'],
    ['roamingAppData', ['Exodus'], 'crypto_wallet'],
    ['roamingAppData', ['atomic'], 'crypto_wallet'],
    ['roamingAppData', ['discord'], 'app_session'],
    ['roamingAppData', ['Telegram Desktop'], 'app_session'],
    ['roamingAppData', ['Signal'], 'app_session'],
    ['roamingAppData', ['Slack'], 'app_session'],
    ['systemRoot', ['System32', 'config'], 'windows'],
  ] as const
).map(([base, names, kind]) => [base, fold(names), kind] as const);

/** Registro do usuário (`NTUSER.DAT` e os arquivos dele), na raiz da pasta do usuário. */
const USER_HIVE = /^ntuser\./i;

function startsWith(path: WindowsPath, base: WindowsPath, names: Folded): boolean {
  const prefix = [...base.folded, ...names];
  if (path.folded.length < prefix.length) return false;
  return prefix.every((name, index) => path.folded[index] === name);
}

/** O tipo de segredo que o caminho é (ou guarda), ou `null`. */
export function sensitiveKind(path: WindowsPath, places: GatePlaces): SensitiveKind | null {
  for (const name of path.folded.slice(1)) {
    const kind = DIRECTORIES_ANYWHERE.get(name);
    if (kind !== undefined) return kind;
  }
  const last = path.parts.at(-1);
  if (last !== undefined) {
    const kind = FILE_NAMES.get(foldCase(last));
    if (kind !== undefined) return kind;
    for (const [pattern, patternKind] of FILE_PATTERNS) if (pattern.test(last)) return patternKind;
  }
  for (const [base, names, kind] of UNDER) {
    const place = places[base];
    if (place !== null && startsWith(path, place, names)) return kind;
  }
  if (last !== undefined && path.folded.length === places.home.folded.length + 1 && startsWith(path, places.home, []) && USER_HIVE.test(last)) {
    return 'windows';
  }
  return null;
}
