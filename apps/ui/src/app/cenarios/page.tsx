import type { Metadata } from 'next';
import { LabLoader } from '../../lab/LabLoader';

export const metadata: Metadata = { title: 'Cenários · Jesus' };

/** Aba Cenários (pedido do dono, seção 8.8): fica da fase 1 até a final. */
export default function CenariosPage() {
  return <LabLoader />;
}
