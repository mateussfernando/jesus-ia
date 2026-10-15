import { BrowserWindow, webFrameMain } from 'electron';
import type { Session, WebContents } from 'electron';
import { isAllowedNavigation, isAppOrigin } from './policy/url';

/**
 * Janela do Jesus e as guardas de cada `webContents` (seção 3.12). Sem preload, sem Node, sandbox ligada, sem
 * `webview`, sem janelas novas, navegação só dentro de `https://jesus.invalid`, e um vigia que acusa qualquer quadro
 * com outra origem (inclusive a opaca, "null").
 */

export interface Violation {
  readonly kind: 'navigation' | 'redirect' | 'window-open' | 'webview' | 'frame-origin';
  readonly url: string;
}

/** Guardas que valem para qualquer `webContents` criado no app (ligadas em `web-contents-created`). */
export function guardWebContents(contents: WebContents, onViolation: (violation: Violation) => void): void {
  contents.setWindowOpenHandler(({ url }) => {
    onViolation({ kind: 'window-open', url });
    return { action: 'deny' };
  });
  contents.on('will-frame-navigate', (event) => {
    if (isAllowedNavigation(event.url)) return;
    event.preventDefault();
    onViolation({ kind: 'navigation', url: event.url });
  });
  contents.on('will-redirect', (event) => {
    if (isAllowedNavigation(event.url)) return;
    event.preventDefault();
    onViolation({ kind: 'redirect', url: event.url });
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    onViolation({ kind: 'webview', url: '' });
  });
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault();
    callback('');
  });
  // Vigia de quadros: depois de cada navegação que se completa, a origem do quadro tem que ser a do app.
  contents.on('did-frame-navigate', (_event, url, _code, _status, _isMainFrame, processId, routingId) => {
    const frame = webFrameMain.fromId(processId, routingId);
    const origin = frame?.origin ?? 'null';
    if (!isAppOrigin(origin)) onViolation({ kind: 'frame-origin', url });
  });
}

export interface AppWindowOptions {
  readonly session: Session;
  readonly title: string;
}

export function createAppWindow(options: AppWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: options.title,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    webPreferences: {
      session: options.session,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
      devTools: false,
      enableWebSQL: false,
      experimentalFeatures: false,
    },
  });
  // Com o proxy morto, o WebRTC não pode usar UDP direto (vazaria o IP local).
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.once('ready-to-show', () => win.show());
  return win;
}
