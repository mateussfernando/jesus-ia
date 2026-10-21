import type { KeyRead } from './egress/egress';
import { createTransport } from './egress/transport';
import type { Transport } from './egress/transport';

/**
 * Só no build de teste (o build de produção não tem este código; a busca do `scripts/build.mjs` confere): os testes
 * de ponta a ponta trocam o destino da saída para a API por um servidor HTTPS local, com uma autoridade feita na hora
 * e uma chave falsa, para a conversa inteira rodar com respostas roteirizadas. A conferência do pedido, o teto do dia,
 * o registro e o transporte de verdade continuam no caminho; muda só para onde o transporte conecta e de onde vem a
 * chave (no Linux sem chaveiro, o cofre não guarda chave nenhuma).
 */
export function createTestApi(real: Transport, readKey: () => KeyRead) {
  let current: { readonly transport: Transport; readonly key: string } | null = null;
  const transport: Transport = {
    send: (request, signal) => (current?.transport ?? real).send(request, signal),
    close: () => {
      real.close();
      current?.transport.close();
    },
  };
  return {
    transport,
    readKey: (): KeyRead => (current === null ? readKey() : { ok: true, key: current.key }),
    /** Servidor local em `localhost:port`, com certificado da autoridade `ca` (PEM). */
    useTestApi(port: number, ca: string, key: string): void {
      current?.transport.close();
      current = { transport: createTransport({ host: 'localhost', port, ca: [ca] }), key };
    },
  };
}
