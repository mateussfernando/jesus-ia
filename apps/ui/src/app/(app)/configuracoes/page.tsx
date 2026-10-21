import Link from 'next/link';
import { desktopBridge } from '../../../server/desktop-bridge';
import { requireUnlocked } from '../../../server/guard';
import { ApiKeyForm } from '../../../settings/ApiKeyForm';
import { DailyLimitForm } from '../../../settings/DailyLimitForm';
import { messageFor, NO_VAULT } from '../../../settings/key-messages';
import { NO_SPEND, spendMessageFor } from '../../../settings/spend-messages';
import '../../../settings/settings.css';

/**
 * Configurações (fase 1, etapa 8; decisões 0020 e 0023). A chave da API da Anthropic entra só por aqui e vai para o
 * cofre do Windows (DPAPI), no processo principal. A tela nunca mostra a chave de novo, só se há uma guardada. O teto de
 * gasto do dia também se muda aqui, e quem o guarda e aplica é o principal.
 */
export default async function SettingsPage() {
  await requireUnlocked();
  const bridge = desktopBridge();
  const initial = bridge === null ? NO_VAULT : { ...messageFor(await bridge.vault.status(), ''), message: null };
  const spend = bridge === null ? NO_SPEND : { ...spendMessageFor(await bridge.spend.status(), null), message: null };
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
      <section className="settings-section" aria-labelledby="teto-titulo">
        <h2 id="teto-titulo">Teto de gasto do dia</h2>
        <p>
          O Jesus para de chamar a API quando o gasto do dia chega ao teto. Antes de cada pedido, ele reserva o custo
          máximo possível; por isso, perto do teto, um pedido grande pode ser recusado antes de um pequeno.
        </p>
        <p>Vale de US$ 0,01 a US$ 100,00 por dia e muda na hora. O dia é o do relógio deste computador.</p>
        <DailyLimitForm initial={spend} />
      </section>
      <Link href="/" className="settings-back">
        Voltar ao início
      </Link>
    </main>
  );
}
