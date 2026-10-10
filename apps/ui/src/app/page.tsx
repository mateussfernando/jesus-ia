import Link from 'next/link';
import './home.css';

/**
 * Início. No app de desktop (fase 1), o processo principal abre direto a tela de entrada ou a central de comando;
 * no navegador, esta página leva às telas que já existem.
 */
export default function HomePage() {
  return (
    <main className="home">
      <h1>Jesus</h1>
      <p className="home-lead">Assistente pessoal de IA para Windows. Interface em Next.js (decisão 0013).</p>
      <nav className="home-links" aria-label="Telas">
        <Link href="/cenarios/" className="home-card">
          <strong>Cenários</strong>
          <span>O laboratório do holograma, com cenários roteirizados e dados falsos.</span>
        </Link>
        <Link href="/entrar/" className="home-card">
          <strong>Tela de entrada</strong>
          <span>A senha local do Jesus (hash bcrypt). No navegador, roda em modo de demonstração.</span>
        </Link>
      </nav>
    </main>
  );
}
