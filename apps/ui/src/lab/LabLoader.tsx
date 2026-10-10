'use client';

import dynamic from 'next/dynamic';

/**
 * O holograma usa WebGL, que só existe no navegador: o laboratório carrega só no cliente, sem pré-renderização
 * no build (decisão 0013).
 */
const LabApp = dynamic(() => import('./LabApp').then((m) => m.LabApp), {
  ssr: false,
  loading: () => <p className="lab-loading">Carregando o holograma…</p>,
});

export function LabLoader() {
  return <LabApp />;
}
