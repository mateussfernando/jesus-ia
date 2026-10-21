import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { EntryScreen } from '../../auth/EntryScreen';
import { getAuthRuntime, readAccess } from '../../server/auth-runtime';
import { SESSION_COOKIE } from '../../server/session';

export const metadata: Metadata = { title: 'Entrar · Jesus' };

/**
 * Tela de entrada: senha local do Jesus (decisões 0015 e 0016). Já desbloqueado → início, mas quem decide a hora é
 * a tela: gravar o cookie numa Server Action faz o Next gerar esta página de novo, e o código de recuperação recém-
 * criado ainda precisa ficar na tela até você confirmar que anotou.
 */
export default async function EntrarPage() {
  const runtime = await getAuthRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const unlocked = readAccess(runtime, token, false);
  const setupRequired = runtime.state.lock.kind === 'setup_required';
  return <EntryScreen initial={setupRequired ? 'setup' : 'unlock'} unlocked={unlocked} />;
}
