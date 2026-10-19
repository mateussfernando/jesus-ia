# 0023 — Cérebro num utilityProcess e saída para a API pelo processo principal

- Status: aceita
- Data: 19/10/2026

## Contexto

A fase 1 conversa com o Claude Haiku 5.5 ([decisão 0011](0011-primeiro-modelo-claude-haiku.md)) pelo AI SDK ([decisão 0001](0001-harness-proprio-inspirado-no-claude-code.md)). A chave da API está no cofre do processo principal ([decisão 0020](0020-cofre-da-chave-no-processo-principal.md)). Pela invariante 5 e pela tabela da seção [2.2](../02-arquitetura.md), o Cérebro não vê tokens.

O [plano da fase 1](../rascunhos/plano-fase-1.md) (etapa 9) pede:
- destinos em lista fixa e corpo conferido;
- cabeçalhos em lista, `redirect: 'error'`;
- teto de gasto do dia no próprio principal;
- cancelamento ao bloquear;
- travar o que o ambiente muda nessa saída;
- no Cérebro: download que recusa, `fetch` e `WebSocket` globais que lançam e um substituto do `@ai-sdk/gateway`.

**O que foi medido no Electron 44.7.0 (Node 24.21):**
- O `fetch` do Node e o agente global do `https` obedecem a quatro variáveis de ambiente. Quem as puser no ambiente do Jesus lê a chave no caminho:
  - `NODE_EXTRA_CA_CERTS`: autoridade a mais;
  - `NODE_USE_SYSTEM_CA` com `SSL_CERT_FILE`: autoridades do sistema;
  - `NODE_TLS_REJECT_UNAUTHORIZED=0`: conferência desligada;
  - `NODE_USE_ENV_PROXY` com `HTTPS_PROXY`: proxy.
- Um `https.request` com agente próprio, autoridades explícitas e `rejectUnauthorized: true` não obedece a nenhuma delas.
- O `net.fetch` do Electron passaria pelo handler que responde 403, e o resolvedor do Chromium não resolve nome nenhum (seção 3.12).

**O que foi visto no AI SDK 7:**
- O `@ai-sdk/provider-utils` baixa as URLs das mensagens com o `undici` direto (por `createRequire` e `process.getBuiltinModule`), sem passar pelo `fetch` global.
- O pacote `ai` importa o `@ai-sdk/gateway`, que lê `AI_GATEWAY_API_KEY` e `VERCEL_OIDC_TOKEN` e manda os pedidos para `ai-gateway.vercel.sh`.
- O provedor da Anthropic lê `ANTHROPIC_API_KEY` e `ANTHROPIC_BASE_URL` e aceita imagem e PDF por URL.

## Decisão

- **Cérebro** (utilityProcess `jesus-brain`, `apps/desktop/src/brain-host/`):
  - O ambiente é montado por lista, como o dos outros filhos (sem `ANTHROPIC_*`, `AI_GATEWAY_*`, `VERCEL_*`, `NODE_*` nem proxies).
  - Roda o AI SDK: `ai` 7.0.142 e `@ai-sdk/anthropic` 4.0.81, versões exatas com 3 dias ou mais (as 7.0.143 e 4.0.82 ainda não tinham).
  - O modelo usa o endereço fixo, uma chave de mentira (o provedor exige uma; o principal a troca) e o `fetch` da ponte.
- **Travas do Cérebro**, ligadas antes de o AI SDK carregar:
  - `fetch`, `WebSocket` e `EventSource` globais lançam erro e não podem ser trocados;
  - os módulos de rede do Node (`http`, `https`, `net`, `tls`, `dns`, `dgram`, `child_process`, entre outros) e o `undici` não carregam, nem por `import`/`require` (ganchos de módulo) nem por `process.getBuiltinModule`;
  - `process.binding` lança erro;
  - a busca de módulos fica presa à raiz do app.
- **Download e gateway:**
  - O download do AI SDK (`experimental_download`) recusa toda URL.
  - O empacotamento troca o `@ai-sdk/gateway` por um substituto que recusa tudo. O build e a conferência do pacote falham se o código do gateway aparecer.
- **Ponte com o principal:** pelo `parentPort`, com `id` em cada pedido.
  - O Cérebro manda `api-request` e `api-cancel`; o principal responde `api-head`, `api-chunk`, `api-end` ou `api-error` com o motivo.
  - As mensagens são conferidas com Zod estrito dos dois lados.
  - Um supervisor (`main/supervisor.ts`) sobe o Cérebro e vigia a vida dele com `ping`/`pong`, como no servidor da interface. Mensagem fora do protocolo ou `id` repetido derruba o Cérebro, que sobe de novo.
- **Saída no principal** (`apps/desktop/src/main/egress/`). Para cada pedido:
  1. **Conferência** (`api-policy.ts`):
     - só `POST https://api.anthropic.com/v1/messages`;
     - cabeçalhos em lista: tipo JSON, `anthropic-version: 2023-06-01`, betas numa lista fechada (hoje, os dois que o provedor pede para o que o Jesus usa), a chave de mentira e o `user-agent` (ignorado);
     - corpo de até 2 MB, conferido por lista branca (Zod estrito): modelo `claude-haiku-5-5`, `max_tokens` até 32.000, streaming, blocos de texto, raciocínio, chamada e resultado de ferramenta (só texto), mensagens de sistema, ferramentas próprias numa lista de nomes (vazia até a etapa 13), raciocínio adaptativo, esforço até `high` e cache de 5 minutos.
     - Todo o resto é recusado: `mcp_servers`, `container`, `fallbacks`, `speed`, ferramentas de servidor (busca e leitura na web, execução de código), imagem, documento, fonte por URL, `temperature`, campo desconhecido.
     - **Corpo que sai:** o objeto conferido, serializado de novo. Assim, um JSON com chave repetida não leva um valor à conferência e outro à API.
  2. **Chave:** lida do cofre na hora, com a forma conferida de novo. Vai só nos cabeçalhos de saída, montados do zero.
  3. **Teto do dia:** reserva o pior caso antes de mandar e liquida depois (mais abaixo).
  4. **Registro:** grava a reserva no registro de auditoria antes de mandar. Sem registro, o pedido não sai.
  5. **Transporte** (`transport.ts`):
     - `https.request` com agente próprio e as autoridades que vêm com o Node (`tls.rootCertificates`), nunca as do ambiente ou do sistema;
     - `rejectUnauthorized: true`, TLS 1.2 ou mais, sem proxy;
     - 3xx é falha;
     - prazos: 60 s até o cabeçalho, 120 s parado no meio, 15 min no total;
     - resposta de até 16 MB.
  6. **Resposta ao Cérebro:**
     - em pedaços, com só dois cabeçalhos (`content-type` e `request-id`);
     - cada pedaço é copiado. Um `Buffer` do Node pode ser fatia do reservatório compartilhado, e a mensagem levaria o reservatório inteiro, onde podem estar os cabeçalhos com a chave.
  7. **Liquidação:** pelo uso real, lido dos eventos `message_start` e `message_delta` da resposta, e registro da chamada.
  - No máximo 2 pedidos ao mesmo tempo.
  - Todo pedido termina com uma resposta ao Cérebro. Um erro inesperado no próprio principal vira `internal` e nunca derruba o principal; o Cérebro é que cai e sobe de novo.
- **Teto de gasto do dia** (`spend.ts`, com o livro de gastos do `packages/models`):
  - **Padrão:** US$ 1 por dia, cerca de dez vezes o uso típico estimado.
  - **Reserva antes do pedido, pelo pior caso:** cada byte do corpo como um token gravado no cache, mais 4.096 de folga, na faixa de preço desse tamanho, mais o `max_tokens` inteiro de saída. O que não cabe na sobra do dia é recusado antes de sair.
  - **Liquidação pelo uso real:**
    - sem a saída final, a saída conta inteira;
    - sem uso nenhum, vale o pior caso;
    - erro da API (fora de 2xx), redirecionamento e pedido que não saiu não são cobrados.
  - **O dia:** é o local, no fuso do sistema, e só avança.
  - **Ao abrir o app:** o gasto do dia é refeito pelo registro de auditoria. Soma o custo de cada `api.call` do dia. Cada `api.reserved` sem `api.call` (o app caiu no meio) conta pelo valor reservado inteiro.
- **Registro de auditoria:**
  - `api.reserved`: antes de mandar;
  - `api.call`: resultado, status, id do pedido na Anthropic, uso, custo, se é estimado e duração;
  - `api.refused` e `api.over_budget`: no máximo um por minuto de cada, com a contagem dos que ficaram de fora;
  - `brain.ready`, `brain.exited`, `brain.failed` e `brain.gave_up`.
  - Nunca a chave nem o conteúdo.
- **Bloqueio e Cérebro caído:**
  - O bloqueio do Jesus (decisão 0019) interrompe todos os pedidos em andamento, e o Cérebro recebe `locked`.
  - Se o Cérebro cair, o que estava com ele é cancelado.
- **Variáveis de ambiente:** o principal registra no log os nomes das variáveis de ambiente que mudariam um `fetch` comum e que o transporte ignora (nunca os valores).

## Consequências

- **Onde a chave pode estar:** no cofre e, de passagem, na memória do principal, na hora de montar os cabeçalhos. Nunca no Cérebro, no ambiente dele, nas mensagens da ponte, no registro ou nos logs.
- **Testes:**
  - o caminho inteiro com o AI SDK de verdade;
  - o ambiente do Cérebro lido de `/proc/<pid>/environ`, com o app aberto num ambiente que traz uma chave falsa;
  - o transporte num processo com as quatro variáveis, no Node dos testes e no do Electron, com o `fetch` global como controle (ele obedece a elas).
- **O plano dizia "`fetch` do Node no principal".** A medição mostrou que ele obedece ao ambiente, e o transporte é o `https` com agente próprio.
- **Rede que só sai por proxy ou com inspeção de TLS** (rede de empresa, antivírus que abre o HTTPS): o Jesus não passa por ela, de propósito, e a conversa falha com `network`.
  - As autoridades aceitas são as da versão do Electron; atualizar o Electron as atualiza.
- **O teto é conservador:** perto do limite do dia, um pedido com contexto grande é recusado antes de um pequeno, porque a reserva conta o pior caso. A etapa 10 mostra isso na conversa; o valor do teto pode virar configuração.
- **O Cérebro não é barreira contra código rodando nele** (o utilityProcess não tem a sandbox do Chromium). Ele não tem chave nem rede, e a barreira é a conferência do principal.
- **Atualizar o AI SDK** pode trazer campos novos no corpo, que a conferência recusa. O teste com o AI SDK de verdade pega isso antes de o app sair.
- **Fica para a etapa 10:** o laço da conversa, o histórico, os pontos de cache, a saída máxima pelo orçamento, a tela e um destino de teste para o teste de ponta a ponta da conversa.

## Detalhes

`apps/desktop/src/main/egress/` · `apps/desktop/src/main/brain-process.ts` · `apps/desktop/src/main/supervisor.ts` · `apps/desktop/src/brain-host/` · `apps/desktop/src/bridge/brain-protocol.ts` · `apps/desktop/scripts/build.mjs` · seções [3.5](../03-seguranca.md), [3.12](../03-seguranca.md), [3.14](../03-seguranca.md), [3.15](../03-seguranca.md) e [3.16](../03-seguranca.md)
