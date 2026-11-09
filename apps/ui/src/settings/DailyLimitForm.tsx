'use client';

import { useState } from 'react';
import { saveDailyLimit } from '../app/(app)/configuracoes/actions';
import type { SpendSettingsState } from './spend-messages';

/** Teto de gasto do dia (decisão 0023): o principal confere, grava no registro e aplica na hora. */
export function DailyLimitForm({ initial }: { initial: SpendSettingsState }) {
  const [state, setState] = useState(initial);
  const [value, setValue] = useState(initial.limitInput);
  const [busy, setBusy] = useState(false);

  const submit = async (text: string) => {
    setBusy(true);
    try {
      const next = await saveDailyLimit(text);
      setState(next);
      if (next.ok) setValue(next.limitInput);
    } catch {
      setState({ ...state, ok: false, message: 'Não deu para falar com o servidor. Tente de novo.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-key">
      {state.summary !== null ? (
        <p className="settings-summary">
          {state.summary}
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(value);
        }}
      >
        <label htmlFor="daily-limit">Teto por dia (em dólares)</label>
        <input
          id="daily-limit"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="1,00"
          maxLength={12}
          disabled={busy || !state.available}
        />
        <div className="settings-actions">
          <button type="submit" disabled={busy || !state.available || value.trim() === ''}>
            Salvar teto
          </button>
        </div>
      </form>
      {state.message !== null && state.message !== '' ? (
        <p className={state.ok ? 'settings-message' : 'settings-message settings-error'} role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
