import Link from 'next/link';
import { desktopBridge } from '../../../server/desktop-bridge';
import { requireUnlocked } from '../../../server/guard';
import { ApiKeyForm } from '../../../settings/ApiKeyForm';
import { messageFor, NO_VAULT } from '../../../settings/key-messages';
import '../../../settings/settings.css';

/**
 * Configurações (fase 1, etapa 8; decisão 0020). A chave da API da Anthropic entra só por aqui e vai para o cofre do
 * Windows (DPAPI), no processo principal. A tela nunca mostra a chave de novo, só se há uma guardada.
 */
export default async function SettingsPage() {
  await requireUnlocked();
  const bridge = desktopBridge();
  const initial = bridge === null ? NO_VAULT : { ...messageFor(await bridge.vault.status(), ''), message: null };
  return (
    <main className="settings">
      <h1>Configurações</h1>
      <section className="settings-section" aria-labelledby="chave-titulo">
        <h2 id="chave-titulo">Chave da API da Anthropic</h2>
        <p>
          O Jesus usa o Claude Haiku 5.5 pela API da Anthropic. A chave fica cifrada no cofre do Windows, neste computador,
          e não aparece de novo em lugar nenhum: nem nesta tela, nem nos registros.
        </p>
        <p>
          Use uma chave de API comum, com limite de gasto no Console. Chave de administrador da organização é recusada.
        </p>
        <ApiKeyForm initial={initial} />
      </section>
      <Link href="/" className="settings-back">
        Voltar ao início
      </Link>
    </main>
  );
}
