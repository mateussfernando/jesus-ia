import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jesus',
  description: 'Assistente pessoal de IA para Windows.',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#04060a',
};

/**
 * Toda página é gerada a cada pedido: é o que permite um nonce novo na CSP (seção 3.12; decisão 0016) e a
 * checagem do bloqueio no servidor.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
