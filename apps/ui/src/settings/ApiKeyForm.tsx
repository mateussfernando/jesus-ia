'use client';

import { useState } from 'react';
import { removeAnthropicKey, saveAnthropicKey } from '../app/(app)/configuracoes/actions';
import type { KeySettingsState } from './key-messages';

const STATE_TEXT: Readonly<Record<KeySettingsState['anthropicKey'], string>> = {
  present: 'Guardada no cofre.',
  absent: 'Nenhuma chave guardada.',
  unknown: 'Não deu para ler a chave no cofre. Guarde a chave de novo.',
  no_vault: 'Sem cofre (desenvolvimento).',
};

/** Formulário da chave da API: a chave sai do campo assim que é enviada e nunca volta para a tela. */
export function ApiKeyForm({ initial }: { initial: KeySettingsState }) {
  const [state, setState] = useState(initial);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<KeySettingsState>) => {
    setBusy(true);
    try {
      setState(await action());
    } catch {
      setState({ ...state, ok: false, message: 'Não deu para falar com o servidor. Tente de novo.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-key">
      <p className="settings-state" data-key-state={state.anthropicKey}>
        {STATE_TEXT[state.anthropicKey]}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = key;
          setKey('');
          void run(() => saveAnthropicKey(value));
        }}
      >
        <label htmlFor="anthropic-key">Chave de API</label>
        <input
          id="anthropic-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="sk-ant-api03-…"
          maxLength={512}
          disabled={busy || state.anthropicKey === 'no_vault'}
        />
        <div className="settings-actions">
          <button type="submit" disabled={busy || key.trim() === '' || state.anthropicKey === 'no_vault'}>
            Guardar
          </button>
          <button
            type="button"
            disabled={busy || (state.anthropicKey !== 'present' && state.anthropicKey !== 'unknown')}
            onClick={() => void run(removeAnthropicKey)}
          >
            Apagar chave
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
