import type { SpendDay, SpendResult } from '../server/desktop-bridge';

/**
 * Teto de gasto do dia na tela Configurações (decisão 0023). O texto sai pronto do servidor (a página não formata
 * números: assim o que o servidor e o navegador mostram é o mesmo). Quem decide a faixa e aplica é o processo
 * principal; aqui a conferência é só para a mensagem sair clara.
 */

/** Picodólares num centavo de dólar (US$ 1 = 10¹² pUSD). */
const P_USD_PER_CENT = 10_000_000_000;
/** Faixa do teto, em centavos: de US$ 0,01 a US$ 100,00 por dia (a mesma do principal). */
export const MIN_LIMIT_CENTS = 1;
export const MAX_LIMIT_CENTS = 10_000;

const USD = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function formatUsd(pUsd: number): string {
  return USD.format(pUsd / 1_000_000_000_000);
}

/** O teto como ele aparece no campo: "1,00". */
export function limitInputValue(pUsd: number): string {
  return (Math.round(pUsd / P_USD_PER_CENT) / 100).toFixed(2).replace('.', ',');
}

const LIMIT_INPUT = /^\s*(?:US\$\s*)?(\d{1,3})(?:[.,](\d{1,2}))?\s*$/;

/** Lê o que foi digitado ("2", "2,5", "2.50", "US$ 0,05"). Fora da faixa ou fora do formato: recusa. */
export function parseDailyLimit(text: string): { readonly ok: true; readonly pUsd: number } | { readonly ok: false } {
  const match = LIMIT_INPUT.exec(text);
  if (match === null) return { ok: false };
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < MIN_LIMIT_CENTS || cents > MAX_LIMIT_CENTS) return { ok: false };
  return { ok: true, pUsd: cents * P_USD_PER_CENT };
}

export interface SpendSettingsState {
  /** Sem o processo principal (desenvolvimento), não há teto para mostrar nem mudar. */
  readonly available: boolean;
  /** "Gasto hoje: US$ 0,03 de US$ 1,00." */
  readonly summary: string | null;
  /** O teto atual, como vai no campo. */
  readonly limitInput: string;
  readonly ok: boolean;
  readonly message: string | null;
}

const PROBLEMS: Readonly<Record<NonNullable<SpendResult['problem']>, string>> = {
  range: 'O teto precisa ficar entre US$ 0,01 e US$ 100,00 por dia.',
  audit: 'O registro de auditoria não gravou a mudança, e o teto ficou como estava.',
  failed: 'Não deu para falar com o processo principal agora. Tente de novo.',
};

function summarize(day: SpendDay): string {
  const total = day.spentPUsd + day.reservedPUsd;
  const pending = day.reservedPUsd > 0 ? ` (com ${formatUsd(day.reservedPUsd)} em andamento)` : '';
  return `Gasto hoje: ${formatUsd(total)}${pending} de ${formatUsd(day.limitPUsd)}.`;
}

export function spendMessageFor(result: SpendResult, done: string | null): SpendSettingsState {
  return {
    available: true,
    summary: result.day === undefined ? null : summarize(result.day),
    limitInput: result.day === undefined ? '' : limitInputValue(result.day.limitPUsd),
    ok: result.ok,
    message: result.ok ? done : PROBLEMS[result.problem ?? 'failed'],
  };
}

export const NO_SPEND: SpendSettingsState = {
  available: false,
  summary: null,
  limitInput: '',
  ok: false,
  message: 'O teto de gasto só existe no app de desktop. Aqui (desenvolvimento), nada sai para a API.',
};
