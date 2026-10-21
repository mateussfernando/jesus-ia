import type { Session } from 'electron';
import { refuseRequest } from './app-protocol';
import { decidePermission } from './policy/permissions';
import type { PermissionPolicy } from './policy/permissions';

/**
 * Sessões do Electron (seção 3.12; decisões 0016 e 0017). A janela do Jesus usa a partição em memória `jesus` (sem
 * `persist:`: nada da sessão vai para o disco). A sessão padrão não é usada por nenhuma janela e fica trancada do
 * mesmo jeito, para nada sair por ela.
 *
 * Nunca registrar ouvintes de `webRequest` nestas sessões: no Electron 44.7.0, qualquer ouvinte faz a página depois
 * de um 3xx herdar a CSP do 3xx, e a tela de entrada quebra.
 */

export const APP_PARTITION = 'jesus';

/**
 * Proxy que não existe: se algum pedido escapar do `protocol.handle` (WebSocket, pré-conexão, DNS do Chromium), ele
 * morre aqui. `<-loopback>` tira a exceção automática de localhost, então nem a máquina local é alcançada.
 */
const DEAD_PROXY = { mode: 'fixed_servers', proxyRules: 'socks5://0.0.0.0:9', proxyBypassRules: '<-loopback>' } as const;

function requestingOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'null';
  }
}

/** O que vale para as duas sessões: sem rede, sem permissões, sem dispositivos, sem downloads, sem corretor. */
async function lockDown(ses: Session, policy: PermissionPolicy): Promise<void> {
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(
      decidePermission(
        {
          permission,
          requestingOrigin: requestingOrigin(details.requestingUrl),
          isMainFrame: details.isMainFrame,
          ...(mediaTypes === undefined ? {} : { mediaTypes }),
        },
        policy,
      ),
    );
  });
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback(null));
  ses.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }));
  ses.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('select-serial-port', (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback('');
  });
  ses.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on('will-download', (event) => event.preventDefault());
  // O corretor baixaria dicionários da internet.
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);
  await ses.setProxy(DEAD_PROXY);
}

/** Sessão padrão: nenhuma janela usa; qualquer pedido por ela é recusado. */
export async function lockDownDefaultSession(ses: Session): Promise<void> {
  for (const scheme of ['https', 'http', 'file'] as const) ses.protocol.handle(scheme, () => refuseRequest());
  await lockDown(ses, { voice: false });
}

/** Sessão da janela do Jesus: `https://jesus.invalid` vai para o servidor da interface; `http:` e `file:`, 403. */
export async function setupAppSession(
  ses: Session,
  handleHttps: (request: Request) => Promise<Response>,
  policy: PermissionPolicy,
): Promise<void> {
  ses.protocol.handle('https', handleHttps);
  for (const scheme of ['http', 'file'] as const) ses.protocol.handle(scheme, () => refuseRequest());
  await lockDown(ses, policy);
}
