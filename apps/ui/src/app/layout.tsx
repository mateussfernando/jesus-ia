import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
