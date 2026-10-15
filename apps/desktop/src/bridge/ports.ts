/**
 * Formatos mínimos dos objetos de IPC do Electron usados pela ponte, para o código da ponte ser testado em Node puro
 * (com os falsos de `fake-ipc.ts`) e ligado ao Electron só nas pontas (`utilityProcess`, `MessageChannelMain`,
 * `process.parentPort`).
 */

/** Evento de mensagem de um `MessagePortMain` ou do `parentPort`: os dados e os ports transferidos junto. */
export interface PortMessageEvent {
  readonly data: unknown;
  readonly ports: readonly MessagePortLike[];
}

/** `MessagePortMain` do Electron (igual no processo principal e no utilityProcess). */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: PortMessageEvent) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
}

/** `process.parentPort` dentro do utilityProcess. */
export interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: PortMessageEvent) => void): unknown;
}

/** `UtilityProcess` visto do processo principal. */
export interface UtilityChildLike {
  readonly pid: number | undefined;
  postMessage(message: unknown, transfer?: MessagePortLike[]): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface ChannelLike {
  readonly port1: MessagePortLike;
  readonly port2: MessagePortLike;
}

/** Port de um pedido, já com os dados soltos do evento. */
export interface BridgePort {
  post(message: unknown): void;
  onMessage(listener: (data: unknown) => void): void;
  /** O outro lado fechou (ou o processo dele caiu). */
  onClose(listener: () => void): void;
  close(): void;
}

export function wrapPort(port: MessagePortLike): BridgePort {
  let closed = false;
  return {
    post(message) {
      if (!closed) port.postMessage(message);
    },
    onMessage(listener) {
      port.on('message', (event) => listener(event.data));
      port.start();
    },
    onClose(listener) {
      port.on('close', listener);
    },
    close() {
      if (closed) return;
      closed = true;
      port.close();
    },
  };
}
