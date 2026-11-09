'use client';

import {
  MIN_PASSWORD_CHARS,
  RECOMMENDED_PASSWORD_CHARS,
  checkNewPassword,
  passwordProblemText,
} from '@jesus/auth';
import type { PasswordProblem, RecoveryResult, SetupResult, UnlockResult } from '@jesus/auth';
import { BCRYPT_MAX_BYTES } from '@jesus/crypto/password';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { recoverWithCode, setupPassword, unlockWithPassword } from '../app/entrar/actions';
import './entry.css';

/**
 * Tela de entrada do Jesus (decisões 0015 e 0016): criar a senha na primeira vez, desbloquear e recuperar com o
 * código. A tela só mostra e coleta: quem confere a senha é o servidor do app, pelas Server Actions de
 * `app/entrar/actions.ts`. A página nunca recebe o hash e não consegue se desbloquear sozinha.
 */

type Screen =
  | { kind: 'setup' }
  | { kind: 'show_code'; code: string }
  | { kind: 'unlock' }
  | { kind: 'recover' };

function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
}

function unlockMessage(result: Exclude<UnlockResult, { ok: true }>): string {
  switch (result.reason) {
    case 'wrong_password':
      if (result.retryAfterMs > 0) return `Senha errada. Espere ${formatWait(result.retryAfterMs)} para tentar de novo.`;
      return result.freeAttemptsLeft === 1
        ? 'Senha errada. Mais um erro e o Jesus pede para esperar.'
        : `Senha errada. Restam ${String(result.freeAttemptsLeft)} tentativas antes de esperar.`;
    case 'throttled':
      return `Muitas tentativas erradas. Espere ${formatWait(result.retryAfterMs)}.`;
    case 'not_set':
      return NOT_SET_MESSAGE;
    case 'busy':
      return 'Conferindo a tentativa anterior…';
  }
}

/** A senha sumiu com o app bloqueado: criar outra só depois de fechar e abrir (o estado é lido ao abrir). */
const NOT_SET_MESSAGE = 'Não há senha guardada. Feche e abra o Jesus de novo para criar uma.';

function recoveryMessage(result: Exclude<RecoveryResult, { ok: true }>): string | null {
  switch (result.reason) {
    case 'invalid_code':
      return result.retryAfterMs > 0
        ? `Código errado. Espere ${formatWait(result.retryAfterMs)} para tentar de novo.`
        : 'Código errado. Confira o que você anotou (20 letras e números, em 4 grupos).';
    case 'throttled':
      return `Muitas tentativas erradas. Espere ${formatWait(result.retryAfterMs)}.`;
    case 'not_set':
      return NOT_SET_MESSAGE;
    case 'busy':
      return 'Conferindo a tentativa anterior…';
    case 'weak_password':
      return null;
  }
}

function setupMessage(result: Exclude<SetupResult, { ok: true }>): string | null {
  switch (result.reason) {
    case 'already_set':
      return 'A senha já foi criada. Feche e abra o Jesus de novo para desbloquear.';
    case 'busy':
      return 'Criando a senha (pedido anterior ainda em andamento)…';
    case 'weak_password':
      return null;
  }
}

/** Campo de senha nova com as regras ao vivo e o contador de bytes do bcrypt. */
function NewPasswordFields(props: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  problems: readonly PasswordProblem[];
}) {
  const check = checkNewPassword(props.password);
  const mismatch = props.confirm.length > 0 && props.confirm !== props.password;
  return (
    <>
      <label className="field">
        <span>Senha nova</span>
        <input
          type="password"
          autoComplete="new-password"
          value={props.password}
          onChange={(e) => props.onPassword(e.target.value)}
          aria-describedby="password-rules"
        />
      </label>
      <p id="password-rules" className={`rules ${check.bytes > BCRYPT_MAX_BYTES ? 'rules-error' : ''}`}>
        {check.chars} caracteres · {check.bytes} de {BCRYPT_MAX_BYTES} bytes. Mínimo {MIN_PASSWORD_CHARS};{' '}
        {RECOMMENDED_PASSWORD_CHARS} ou mais é melhor (uma frase com 4 palavras serve).
        {check.ok && check.strong && <strong> Boa senha.</strong>}
      </p>
      <label className="field">
        <span>Repita a senha</span>
        <input
          type="password"
          autoComplete="new-password"
          value={props.confirm}
          onChange={(e) => props.onConfirm(e.target.value)}
        />
      </label>
      {mismatch && <p className="error">As duas senhas não são iguais.</p>}
      {props.problems.length > 0 && (
        <ul className="error-list">
          {props.problems.map((p) => (
            <li key={p}>{passwordProblemText[p]}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="entry-panel" aria-labelledby="entry-title">
      <h1 id="entry-title">{title}</h1>
      {children}
    </section>
  );
}

export function EntryScreen({ initial, unlocked }: { initial: 'setup' | 'unlock'; unlocked: boolean }) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ kind: initial });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [problems, setProblems] = useState<readonly PasswordProblem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [codeSaved, setCodeSaved] = useState(false);

  // Desbloqueado (agora ou numa visita anterior) → início; menos enquanto o código de recuperação está na tela.
  useEffect(() => {
    if (unlocked && screen.kind !== 'show_code') router.replace('/');
  }, [unlocked, screen.kind, router]);

  function resetFields() {
    setPassword('');
    setConfirm('');
    setCode('');
    setProblems([]);
    setMessage(null);
  }

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setMessage(null);
    try {
      await action();
    } catch {
      setMessage('Não deu para concluir. Tente de novo.');
    } finally {
      setWorking(false);
    }
  }

  let body: ReactNode;
  switch (screen.kind) {
    case 'setup':
      body = (
        <Panel title="Crie a senha do Jesus">
          <p className="lead">
            Ela protege o Jesus de quem usar o seu PC desbloqueado. Fica guardada só como hash bcrypt: ninguém
            consegue ler a senha de volta, nem o Jesus. Não é a senha de nenhuma conta sua.
          </p>
          <form
            onSubmit={(e) =>
              submit(e, async () => {
                if (password !== confirm) {
                  setMessage('As duas senhas não são iguais.');
                  return;
                }
                const result = await setupPassword(password);
                if (result.ok) {
                  resetFields();
                  setScreen({ kind: 'show_code', code: result.recoveryCode });
                } else if (result.reason === 'weak_password') {
                  setProblems(result.problems);
                } else {
                  setMessage(setupMessage(result));
                }
              })
            }
          >
            <NewPasswordFields
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
              problems={problems}
            />
            {message !== null && <p className="error">{message}</p>}
            <button type="submit" className="primary" disabled={working || password.length === 0}>
              {working ? 'Criando…' : 'Criar senha'}
            </button>
          </form>
        </Panel>
      );
      break;

    case 'show_code':
      body = (
        <Panel title="Anote o código de recuperação">
          <p className="lead">
            É a única forma de trocar a senha se você esquecer. Ele aparece só agora: anote em papel ou no seu
            gerenciador de senhas. O Jesus guarda só o hash dele.
          </p>
          <p className="recovery-code" aria-label="Código de recuperação">
            {screen.code}
          </p>
          <label className="check">
            <input type="checkbox" checked={codeSaved} onChange={(e) => setCodeSaved(e.target.checked)} />
            <span>Anotei o código num lugar seguro.</span>
          </label>
          <button
            type="button"
            className="primary"
            disabled={!codeSaved}
            onClick={() => {
              setCodeSaved(false);
              router.replace('/');
            }}
          >
            Continuar
          </button>
        </Panel>
      );
      break;

    case 'unlock':
      body = (
        <Panel title="Desbloquear o Jesus">
          <form
            onSubmit={(e) =>
              submit(e, async () => {
                const result = await unlockWithPassword(password);
                setPassword('');
                if (result.ok) router.replace('/');
                else setMessage(unlockMessage(result));
              })
            }
          >
            <label className="field">
              <span>Senha</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </label>
            {message !== null && (
              <p className="error" role="alert">
                {message}
              </p>
            )}
            <button type="submit" className="primary" disabled={working || password.length === 0}>
              {working ? 'Conferindo…' : 'Desbloquear'}
            </button>
          </form>
          <button
            type="button"
            className="link"
            onClick={() => {
              resetFields();
              setScreen({ kind: 'recover' });
            }}
          >
            Esqueci a senha
          </button>
        </Panel>
      );
      break;

    case 'recover':
      body = (
        <Panel title="Trocar a senha com o código de recuperação">
          <form
            onSubmit={(e) =>
              submit(e, async () => {
                if (password !== confirm) {
                  setMessage('As duas senhas não são iguais.');
                  return;
                }
                const result = await recoverWithCode(code, password);
                if (result.ok) {
                  resetFields();
                  setScreen({ kind: 'show_code', code: result.recoveryCode });
                } else if (result.reason === 'weak_password') {
                  setProblems(result.problems);
                } else {
                  setMessage(recoveryMessage(result));
                }
              })
            }
          >
            <label className="field">
              <span>Código de recuperação</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              />
            </label>
            <NewPasswordFields
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
              problems={problems}
            />
            {message !== null && (
              <p className="error" role="alert">
                {message}
              </p>
            )}
            <button type="submit" className="primary" disabled={working || code.length === 0 || password.length === 0}>
              {working ? 'Conferindo…' : 'Trocar a senha'}
            </button>
          </form>
          <button
            type="button"
            className="link"
            onClick={() => {
              resetFields();
              setScreen({ kind: 'unlock' });
            }}
          >
            Voltar
          </button>
        </Panel>
      );
      break;

  }

  return (
    <main className="entry">{body}</main>
  );
}
