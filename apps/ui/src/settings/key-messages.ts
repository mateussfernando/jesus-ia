import type { VaultResult } from '../server/desktop-bridge';

/** O que a tela mostra para cada resposta do cofre (sem nunca repetir a chave). */
export interface KeySettingsState {
  readonly anthropicKey: VaultResult['anthropicKey'] | 'no_vault';
  readonly message: string | null;
  readonly ok: boolean;
}

const PROBLEMS: Readonly<Record<NonNullable<VaultResult['problem']>, string>> = {
  unavailable: 'O cofre do sistema não está disponível neste computador. A chave não foi guardada.',
  insecure_backend: 'Este sistema não tem um chaveiro seguro para o cofre. A chave não foi guardada.',
  admin: 'Essa é uma chave de administrador da organização. Crie uma chave de API comum no Console da Anthropic.',
  format: 'Isso não parece uma chave de API da Anthropic (começa com "sk-ant-api").',
  failed: 'Não deu para falar com o cofre agora. Tente de novo.',
};

export function messageFor(result: VaultResult, done: string): KeySettingsState {
  return {
    anthropicKey: result.anthropicKey,
    ok: result.ok,
    message: result.ok ? done : PROBLEMS[result.problem ?? 'failed'],
  };
}

export const NO_VAULT: KeySettingsState = {
  anthropicKey: 'no_vault',
  ok: false,
  message: 'O cofre só existe no app de desktop. Aqui (desenvolvimento), a chave não é guardada.',
};
