'use client';

import './globals.css';
import './status.css';

/**
 * Tela de erro geral, no lugar da padrão do Next (que usa estilos inline, bloqueados pela CSP). Não mostra detalhes
 * do erro: o servidor registra o resto. Erro ao abrir o login (arquivo da senha ilegível, banco fora do ar) cai
 * aqui, e o próximo pedido tenta de novo.
 */
export default function GlobalError() {
  return (
    <html lang="pt-BR">
      <body>
        <main className="status-page">
          <h1>Algo deu errado</h1>
          <p>O Jesus não conseguiu abrir esta tela. Nada foi feito por conta própria.</p>
          {/* Recarrega de verdade: o reset() só redesenha no navegador o que já falhou, sem pedir de novo. */}
          <button type="button" onClick={() => window.location.reload()}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
