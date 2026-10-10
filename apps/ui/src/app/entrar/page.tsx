import type { Metadata } from 'next';
import { EntryScreen } from '../../auth/EntryScreen';

export const metadata: Metadata = { title: 'Entrar · Jesus' };

/** Tela de entrada: senha local do Jesus (decisão 0015). */
export default function EntrarPage() {
  return <EntryScreen />;
}
