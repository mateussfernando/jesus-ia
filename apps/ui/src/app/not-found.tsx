import type { Metadata } from 'next';
import Link from 'next/link';
import './status.css';

export const metadata: Metadata = { title: 'Não encontrado · Jesus' };

/** Página 404 própria: a padrão do Next usa estilos inline, que a CSP bloqueia (seção 3.12). */
export default function NotFound() {
  return (
    <main className="status-page">
      <h1>Página não encontrada</h1>
      <p>Esse endereço não existe no Jesus.</p>
      <Link href="/">Voltar ao início</Link>
    </main>
  );
}
