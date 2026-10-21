/**
 * Substituto do `@ai-sdk/gateway` no Cérebro (decisão 0023). O pacote `ai` importa o gateway da Vercel para resolver
 * modelos pedidos por nome em texto; o gateway lê do ambiente a chave dele e o token da Vercel e manda os pedidos para
 * o serviço da Vercel. O Jesus sempre passa o objeto do modelo, e o empacotamento troca o pacote por este arquivo:
 * qualquer uso do gateway lança erro, e o código dele nem entra no app (o build confere).
 */

const REFUSAL = 'o Jesus não usa o AI Gateway da Vercel: o modelo é sempre o da saída pelo processo principal';

function refuse(): never {
  throw new Error(REFUSAL);
}

/** Nenhum erro do Jesus é do gateway. */
export class GatewayError extends Error {
  static isInstance(): boolean {
    return false;
  }
}

export class GatewayAuthenticationError extends GatewayError {
  static override isInstance(): boolean {
    return false;
  }
}

export function createGateway(): never {
  return refuse();
}

/** Provedor que recusa tudo: qualquer método pedido lança. Não se parece com promessa (`then` não existe). */
export const gateway: unknown = new Proxy(refuse, {
  get(_target, property) {
    if (property === 'then' || typeof property === 'symbol') return undefined;
    return refuse;
  },
  apply: refuse,
});
