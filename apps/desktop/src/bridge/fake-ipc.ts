import { EventEmitter } from 'node:events';
import type { ChannelLike, MessagePortLike, ParentPortLike, PortMessageEvent, UtilityChildLike } from './ports';

/**
 * Falsos do IPC do Electron para os testes (só os testes importam este arquivo). Imitam o que importa do
 * `MessagePortMain` e do `utilityProcess`: entrega assíncrona, cópia estruturada (o que não é clonável lança, como no
 * Electron), fila até o `start()`, aviso de `close` para o outro lado depois das mensagens pendentes, e um processo
 * que pode cair (os ports que ele recebeu fecham junto). Também imitam três detalhes medidos no Electron 44.7.0:
 * - `close()` local emite `close` no próprio port, na hora;
 * - `kill()` antes do processo subir (evento `spawn`) não faz nada e devolve `false`;
 * - quando o processo sai, o `exit` chega antes das mensagens que ele já tinha mandado pelos ports (o principal vê a
 *   queda primeiro, e a resposta em andamento falha em vez de chegar inteira).
 *
 * O `protocol.handle` não entra aqui: nele, o `request.signal` nunca aborta (a janela desistir antes do cabeçalho não
 * chega ao principal).
 */

type Task = () => void;

function later(task: Task): void {
  setImmediate(task);
}

export class FakeMessagePort extends EventEmitter implements MessagePortLike {
  #peer: FakeMessagePort | null = null;
  #started = false;
  #closed = false;
  readonly #queue: PortMessageEvent[] = [];

  static pair(): ChannelLike & { port1: FakeMessagePort; port2: FakeMessagePort } {
    const port1 = new FakeMessagePort();
    const port2 = new FakeMessagePort();
    port1.#peer = port2;
    port2.#peer = port1;
    return { port1, port2 };
  }

  get closed(): boolean {
    return this.#closed;
  }

  postMessage(message: unknown): void {
    if (this.#closed) return;
    const peer = this.#peer;
    if (peer === null) return;
    const data = structuredClone(message);
    later(() => peer.#receive({ data, ports: [] }));
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    later(() => this.#flush());
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue.length = 0;
    const peer = this.#peer;
    this.#peer = null;
    // O outro lado recebe o que já estava a caminho e só depois o aviso de fechamento.
    if (peer !== null) later(() => later(() => peer.#remoteClosed()));
    this.emit('close');
  }

  #receive(event: PortMessageEvent): void {
    if (this.#closed) return;
    this.#queue.push(event);
    if (this.#started) this.#flush();
  }

  #flush(): void {
    while (this.#started && !this.#closed && this.#queue.length > 0) {
      const event = this.#queue.shift();
      if (event !== undefined) this.emit('message', event);
    }
  }

  #remoteClosed(): void {
    if (this.#closed) return;
    this.#flush();
    this.#closed = true;
    this.#peer = null;
    this.emit('close');
  }
}

export function createFakeChannel(): ChannelLike & { port1: FakeMessagePort; port2: FakeMessagePort } {
  return FakeMessagePort.pair();
}

let nextPid = 40_000;

/**
 * "Processo" filho em memória: `run` recebe o `parentPort` e roda no mesmo processo do teste. Depois de `kill()` ou
 * `crash()`, nada mais passa em nenhuma direção e os ports transferidos para ele fecham (como quando o processo morre).
 */
export class FakeUtilityChild extends EventEmitter implements UtilityChildLike {
  readonly pid: number | undefined = nextPid++;
  readonly received: unknown[] = [];
  #spawned = false;
  #exited = false;
  readonly #parent = new EventEmitter();
  readonly #transferred: MessagePortLike[] = [];

  constructor(run: (parent: ParentPortLike) => void) {
    super();
    const parent: ParentPortLike = {
      postMessage: (message) => {
        if (this.#exited) return;
        const data = structuredClone(message);
        later(() => {
          if (!this.#exited) this.emit('message', data);
        });
      },
      on: (event, listener) => this.#parent.on(event, listener),
    };
    later(() => {
      this.#spawned = true;
      this.emit('spawn');
      run(parent);
    });
  }

  get exited(): boolean {
    return this.#exited;
  }

  get spawned(): boolean {
    return this.#spawned;
  }

  postMessage(message: unknown, transfer: MessagePortLike[] = []): void {
    if (this.#exited) return;
    const data = structuredClone(message);
    this.#transferred.push(...transfer);
    this.received.push(data);
    later(() => {
      if (!this.#exited) this.#parent.emit('message', { data, ports: transfer } satisfies PortMessageEvent);
    });
  }

  /** Como no Electron: antes do processo subir, não faz nada. */
  kill(): boolean {
    if (!this.#spawned || this.#exited) return false;
    this.crash(0);
    return true;
  }

  /**
   * O processo caiu com este código de saída. O `exit` vem antes das mensagens que já estavam a caminho pelos ports
   * (como no Electron); depois, os ports que ele recebeu fecham.
   */
  crash(code = 1): void {
    if (this.#exited) return;
    this.#exited = true;
    process.nextTick(() => {
      this.emit('exit', code);
      for (const port of this.#transferred) port.close();
    });
  }
}
