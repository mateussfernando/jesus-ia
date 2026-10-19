import Link from 'next/link';
import { requireUnlocked } from '../../server/guard';
import './home.css';

/**
 * Início (com o Jesus desbloqueado). Na fase 1, a central de comando (chat) entra aqui; por enquanto, os
 * atalhos para o que já existe.
 */
export default async function HomePage() {
  await requireUnlocked();
  return (
    <main className="home">
      <h1>Jesus</h1>
      <p className="home-lead">
        Assistente pessoal de IA para Windows. Interface e back-end no mesmo app Next.js (decisão 0016).
      </p>
      <nav className="home-links" aria-label="Telas">
        <Link href="/cenarios/" className="home-card">
          <strong>Cenários</strong>
          <span>O laboratório do holograma, com cenários roteirizados e dados falsos.</span>
        </Link>
        <Link href="/configuracoes/" className="home-card">
          <strong>Configurações</strong>
          <span>A chave da API da Anthropic, guardada no cofre do Windows.</span>
        </Link>
      </nav>
    </main>
  );
}
