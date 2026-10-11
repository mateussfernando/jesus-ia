import type { Metadata } from 'next';
import { LabLoader } from '../../../lab/LabLoader';
import { requireUnlocked } from '../../../server/guard';

export const metadata: Metadata = { title: 'Cenários · Jesus' };

/** Aba Cenários (pedido do dono, seção 8.8): fica da fase 1 até a final. Só com o Jesus desbloqueado. */
export default async function CenariosPage() {
  await requireUnlocked();
  return <LabLoader />;
}
