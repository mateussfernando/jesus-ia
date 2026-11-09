import Link from 'next/link';
import { ChatPanel } from '../../chat/ChatPanel';
import { desktopBridge } from '../../server/desktop-bridge';
import type { ChatResult } from '../../server/desktop-bridge';
import { requireUnlocked } from '../../server/guard';

/**
 * Início (com o Jesus desbloqueado): a conversa com o Jesus (fase 1, etapa 11; decisões 0024 e 0025) e os atalhos
 * para as outras telas. A conversa mora no Cérebro, no app de desktop; fora dele (`next dev`), a tela avisa.
 */
export default async function HomePage() {
  await requireUnlocked();
  const bridge = desktopBridge();
  const initial: ChatResult = bridge === null ? { ok: false, reason: 'unavailable' } : await bridge.chat.state();
  return (
    <main className="chat-page">
      <header className="chat-header">
        <h1>Jesus</h1>
        <nav className="chat-nav" aria-label="Telas">
          <Link href="/cenarios/">Cenários</Link>
          <Link href="/configuracoes/">Configurações</Link>
        </nav>
      </header>
      <ChatPanel initial={initial} />
    </main>
  );
}
