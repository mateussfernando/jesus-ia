'use client';

import '../zod-jitless';
import { MAX_CHAT_TEXT_CHARS } from '@jesus/core/chat';
import { useEffect, useRef, useState } from 'react';
import { chatState, newChat, stopChat } from '../app/(app)/chat-actions';
import type { ChatResult, ChatState } from '../server/desktop-bridge';
import { contextUsage, CUT_SHORT, noticeFor, UNREACHABLE } from './messages';
import type { ChatNotice } from './messages';
import { runTurn } from './turn-client';
import './chat.css';

/**
 * Tela de conversa (fase 1, etapa 11; decisão 0025). Texto puro: a resposta do modelo entra na página só como texto
 * (o React escapa tudo), sem Markdown, HTML nem links clicáveis. A pergunta vai pela rota do turno, e a resposta chega
 * em pedaços; Parar, Nova conversa e o estado vão por Server Actions. A conversa mora no Cérebro: recarregar a página
 * mostra a mesma conversa, e fechar o app a apaga.
 */

interface Streaming {
  readonly question: string;
  readonly answer: string;
  readonly stopping: boolean;
}

/** Enquanto o Cérebro termina um turno de antes (a página foi recarregada no meio), a tela confere o estado. */
const BUSY_POLL_MS = 1_500;
/** Distância do fim (px) em que a conversa ainda acompanha a resposta chegando. */
const STICK_PX = 48;

function goToEntry() {
  window.location.replace('/entrar/');
}

function Exchange({ user, assistant, pending = false }: { user: string; assistant: string; pending?: boolean }) {
  return (
    <div className="chat-exchange">
      <div className="chat-message chat-user">
        <span className="chat-who">Você</span>
        <p className="chat-text">{user}</p>
      </div>
      <div className="chat-message chat-assistant" aria-busy={pending}>
        <span className="chat-who">Jesus</span>
        {assistant === '' && pending ? <p className="chat-text chat-thinking">Pensando…</p> : <p className="chat-text">{assistant}</p>}
      </div>
    </div>
  );
}

export function ChatPanel({ initial }: { initial: ChatResult }) {
  const [conversation, setConversation] = useState<ChatState | null>(initial.ok ? initial.state : null);
  const [notice, setNotice] = useState<ChatNotice | null>(initial.ok ? null : noticeFor(initial.reason));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [working, setWorking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const apply = (result: ChatResult) => {
    if (result.ok) {
      setConversation(result.state);
      return true;
    }
    if (result.reason === 'locked') goToEntry();
    setNotice(noticeFor(result.reason));
    return false;
  };

  const refresh = async () => {
    try {
      return apply(await chatState());
    } catch {
      setNotice(UNREACHABLE);
      return false;
    }
  };

  // A conversa acompanha a resposta chegando, a menos que o dono tenha rolado para ler mais acima.
  useEffect(() => {
    const log = logRef.current;
    if (log !== null && stick.current) log.scrollTop = log.scrollHeight;
  });

  const busyElsewhere = streaming === null && conversation?.busy === true;
  useEffect(() => {
    if (!busyElsewhere) return;
    const timer = setInterval(() => {
      void chatState()
        .then((result) => {
          if (result.ok) setConversation(result.state);
        })
        .catch(() => undefined);
    }, BUSY_POLL_MS);
    return () => clearInterval(timer);
  }, [busyElsewhere]);

  const send = async () => {
    const question = input.trim();
    if (conversation === null || streaming !== null || busyElsewhere || question === '') return;
    stick.current = true;
    setInput('');
    setNotice(null);
    setStreaming({ question, answer: '', stopping: false });
    const { outcome, answer } = await runTurn(conversation.conversationId, question, (text) =>
      setStreaming((current) => (current === null ? null : { ...current, answer: text })),
    );
    if (outcome === 'unreachable') {
      setNotice(UNREACHABLE);
    } else if (outcome.kind === 'done') {
      const { done } = outcome;
      // A troca entra na tela na hora, como saiu daqui; logo depois vem a do Cérebro (com a pergunta já mascarada),
      // se ainda for a mesma conversa e não estiver atrás da tela.
      setConversation((current) =>
        current === null
          ? null
          : { ...current, turns: [...current.turns, { user: question, assistant: answer }], contextTokens: done.contextTokens, limitTokens: done.limitTokens },
      );
      if (done.finish === 'length') setNotice(CUT_SHORT);
      void chatState()
        .then((result) => {
          if (!result.ok) return;
          setConversation((current) =>
            current !== null && result.state.conversationId === current.conversationId && result.state.turns.length >= current.turns.length
              ? result.state
              : current,
          );
        })
        .catch(() => undefined);
    } else {
      if (outcome.reason === 'locked') goToEntry();
      if (outcome.reason === 'stale') await refresh();
      setNotice(noticeFor(outcome.reason));
      // A pergunta não entrou na conversa: volta para o campo, para mandar de novo ou mudar.
      setInput((current) => (current === '' ? question : current));
    }
    setStreaming(null);
  };

  const stop = async () => {
    setStreaming((current) => (current === null ? null : { ...current, stopping: true }));
    try {
      await stopChat();
    } catch {
      setNotice(UNREACHABLE);
    }
  };

  const reset = async () => {
    setWorking(true);
    try {
      if (apply(await newChat())) setNotice(null);
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setWorking(false);
    }
  };

  const retry = async () => {
    setWorking(true);
    try {
      if (await refresh()) setNotice(null);
    } finally {
      setWorking(false);
    }
  };

  const turns = conversation?.turns ?? [];
  const canSend = conversation !== null && streaming === null && !busyElsewhere && input.trim() !== '';
  return (
    <section className="chat" aria-label="Conversa">
      <div
        className="chat-log"
        role="log"
        aria-busy={streaming !== null}
        ref={logRef}
        onScroll={(event) => {
          const log = event.currentTarget;
          stick.current = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
        }}
      >
        {turns.length === 0 && streaming === null ? (
          <p className="chat-empty">
            Pergunte o que quiser. Nesta versão, o Jesus só conversa: ainda não lê arquivos, não acessa a internet e não
            executa comandos.
          </p>
        ) : null}
        {turns.map((turn, index) => (
          <Exchange key={index} user={turn.user} assistant={turn.assistant} />
        ))}
        {streaming !== null ? <Exchange user={streaming.question} assistant={streaming.answer} pending /> : null}
        {busyElsewhere ? <p className="chat-empty">O Jesus ainda está respondendo a uma pergunta anterior.</p> : null}
      </div>
      {notice !== null ? (
        <p className={notice.tone === 'error' ? 'chat-notice chat-error' : 'chat-notice'} role="status">
          {notice.text}
        </p>
      ) : null}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="chat-input" className="chat-label">
          Sua pergunta
        </label>
        <textarea
          id="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter manda; Shift+Enter quebra a linha.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          rows={3}
          maxLength={MAX_CHAT_TEXT_CHARS}
          placeholder="Escreva sua pergunta…"
          spellCheck
          disabled={conversation === null}
        />
        <div className="chat-actions">
          {streaming !== null || busyElsewhere ? (
            <button type="button" onClick={() => void stop()} disabled={streaming?.stopping === true}>
              {streaming?.stopping === true ? 'Parando…' : 'Parar'}
            </button>
          ) : (
            <button type="submit" disabled={!canSend}>
              Enviar
            </button>
          )}
          {conversation === null ? (
            <button type="button" onClick={() => void retry()} disabled={working}>
              Tentar de novo
            </button>
          ) : (
            <button type="button" onClick={() => void reset()} disabled={working || streaming !== null}>
              Nova conversa
            </button>
          )}
          {conversation !== null ? <span className="chat-usage">{contextUsage(conversation.contextTokens, conversation.limitTokens)}</span> : null}
        </div>
      </form>
    </section>
  );
}
