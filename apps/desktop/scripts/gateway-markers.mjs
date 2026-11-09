// Textos que só existem no cliente do AI Gateway da Vercel (`@ai-sdk/gateway` e `@vercel/oidc`; decisão 0023): o
// endereço do serviço, o cabeçalho de versão do protocolo dele e a leitura do token da Vercel. O build troca o pacote
// por um substituto que recusa tudo; se algum destes aparecer num build ou no pacote, a troca não foi aplicada.
//
// O nome da variável da chave do gateway não serve de marca: o próprio pacote `ai` o cita numa mensagem de erro, que
// entra no Cérebro junto com o `streamText` (etapa 10).
export const GATEWAY_MARKERS = ['ai-gateway.vercel.sh', 'ai-gateway-protocol-version', 'getVercelOidcToken', 'VERCEL_OIDC_TOKEN'];
