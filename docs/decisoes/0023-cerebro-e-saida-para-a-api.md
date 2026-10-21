# 0023 — Cérebro num utilityProcess e saída para a API pelo processo principal

- Status: aceita
- Data: 19/10/2026 (revista em 20/10/2026, depois da revisão independente #3)

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
  - os módulos de rede do Node (`http`, `https`, `net`, `tls`, `dns`, `dgram`, `child_process`, entre outros), as peças internas deles (`_http_client`, `_tls_wrap` e parentes), o `worker_threads` (uma thread nova teria globais e busca de módulos próprios, sem as travas) e o `undici` não carregam, nem por `import`/`require` (ganchos de módulo) nem por `process.getBuiltinModule`;
  - `process.binding` e `process.dlopen` (módulo nativo) lançam erro;
  - a busca de módulos fica presa à raiz do app.
  - As travas pegam o uso por acidente e o código comum de uma dependência; não são barreira contra código que já roda no Cérebro (mais abaixo, em Consequências).
- **Download e gateway:**
  - O download do AI SDK (`experimental_download`) recusa toda URL.
  - O empacotamento troca o `@ai-sdk/gateway` por um substituto que recusa tudo. O build e a conferência do pacote falham se o código do gateway aparecer.
- **Ponte com o principal:** pelo `parentPort`, com `id` em cada pedido.
  - O Cérebro manda `api-request` e `api-cancel`; o principal responde `api-head`, `api-chunk`, `api-end` ou `api-error` com o motivo.
  - As mensagens são conferidas com Zod estrito dos dois lados.
  - Um supervisor (`main/supervisor.ts`) sobe o Cérebro e vigia a vida dele com `ping`/`pong`, como no servidor da interface. Mensagem fora do protocolo ou `id` repetido derruba o Cérebro, que sobe de novo.
  - **Ritmo** (`main/brain-process.ts`): cada pedido custa ao principal a conferência de até 2 MB de JSON, e um Cérebro de verdade espera cada resposta do modelo. Mais de 10 pedidos em 5 s, ou mais de 3 recusas pela lista num minuto, derrubam o Cérebro como fuga do protocolo (o supervisor desiste depois de quedas seguidas).
  - **Corpo acima de 2 MB:** o próprio Cérebro recusa (`too_large`), sem mandar. Mandado, ele seria mensagem fora do protocolo e derrubaria o Cérebro a cada tentativa, até o supervisor desistir.
- **Saída no principal** (`apps/desktop/src/main/egress/`). Para cada pedido:
  1. **Conferência** (`api-policy.ts`):
     - só `POST https://api.anthropic.com/v1/messages`;
     - cabeçalhos em lista: tipo JSON, `anthropic-version: 2023-06-01`, betas numa lista fechada (hoje, os dois que o provedor pede para o que o Jesus usa), a chave de mentira e o `user-agent` (ignorado);
     - corpo de até 2 MB, conferido por lista branca (Zod estrito): modelo `claude-haiku-5-5`, `max_tokens` até 32.000, streaming, blocos de texto, raciocínio, chamada e resultado de ferramenta (só texto), mensagens de sistema, ferramentas próprias numa lista de nomes (vazia até a etapa 13), raciocínio adaptativo, esforço até `high` e cache de 5 minutos.
     - Todo o resto é recusado: `mcp_servers`, `container`, `fallbacks`, `speed`, ferramentas de servidor (busca e leitura na web, execução de código), imagem, documento, fonte por URL, `temperature`, campo desconhecido.
     - **Corpo que sai:** o resultado do esquema estrito, serializado de novo (com as chaves na ordem do esquema). Assim, um JSON com chave repetida não leva um valor à conferência e outro à API, e, se um nível do esquema deixar de ser estrito por engano, a chave desconhecida cai em vez de sair. O limite de 2 MB vale também para o que sai (os escapes do JSON podem crescer o corpo), e texto com metade de um par de surrogates solta é recusado.
     - **Custo limitado** (a conferência roda no principal, com o que o Cérebro manda): até 64 níveis de aninhamento e 250 mil valores, medidos sem recursão antes do esquema; cada lista é medida antes de os elementos serem olhados, e os elementos param no primeiro erro. Antes, um corpo de 2 MB cheio de elementos inválidos prendia o principal de 1 a 8 s e alocava mais de 1 GB (o Zod acumula um erro por elemento); hoje, o grosso é o `JSON.parse` (até uns 0,2 s).
  2. **Chave:** lida do cofre na hora, com a forma conferida de novo. Vai só nos cabeçalhos de saída, montados do zero, e entra no pedido depois de criado (`setHeader`), nunca nas opções do `https.request`: o Node imprime essas opções inteiras no stderr com `NODE_DEBUG=https`.
  3. **Teto do dia:** reserva o pior caso antes de mandar e liquida depois (mais abaixo).
  4. **Registro:** grava a reserva no registro de auditoria antes de mandar. Sem registro, o pedido não sai. Bloqueio, desistência ou Cérebro caído enquanto a reserva grava: o pedido nem sai, nada é cobrado, e o `api.call` diz `locked` ou `cancelled`. O transporte também não abre conexão para um pedido já cancelado.
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
  - **O dono escolhe o valor na tela Configurações** (pedido dele, 19/10/2026), de US$ 0,01 a US$ 100,00 por dia:
    - a Server Action confere a sessão e o formato; o principal confere a faixa de novo;
    - a mudança vai ao registro de auditoria (`spend.limit_set`, com o valor anterior) e só vale se gravou;
    - vale na hora: abaixo do gasto do dia, os pedidos seguintes são recusados até o dia virar;
    - **o registro é a fonte do teto:** ao abrir, vale o último `spend.limit_set` válido (de qualquer dia); sem nenhum, o padrão. Nada de arquivo de configuração à parte, que não teria a cadeia do registro.
    - Só o servidor da interface, com a sessão aberta, pede a mudança. O Cérebro não tem esse caminho: a ponte dele só leva pedidos à API.
  - **Reserva antes do pedido, pelo pior caso:** cada byte do corpo como um token gravado no cache, mais 4.096 de folga, mais 32.000 tokens por bloco de raciocínio devolvido (`thinking` ou `redacted_thinking`), na faixa de preço desse tamanho, mais o `max_tokens` inteiro de saída. O que não cabe na sobra do dia é recusado antes de sair.
    - Por que o raciocínio conta à parte: no Claude Haiku 5.5, o raciocínio vem cifrado na assinatura do bloco, e o modelo o lê de volta como entrada, cobrada pelo tamanho original, não pelos bytes do bloco. Esse tamanho nunca passa da saída máxima da resposta que o gerou (todas passaram por esta saída, com `max_tokens` até 32.000). Bloco de outra conta, ou de um modelo que o Haiku 5.5 não lê, cai sem cobrança.
  - **Liquidação pelo uso real:**
    - sem a saída final, a saída conta inteira;
    - sem uso nenhum, vale o pior caso;
    - erro da API (fora de 2xx), redirecionamento e pedido que não saiu não são cobrados.
  - **O dia:** é o local, no fuso do sistema, e só avança.
  - **Ao abrir o app:** o gasto do dia é refeito pelo registro de auditoria. Soma o custo de cada `api.call` do dia. Cada `api.reserved` sem `api.call` (o app caiu no meio) conta pelo valor reservado inteiro.
  - **Registro posto de lado** (cadeia quebrada, âncora ilegível; decisão 0022): o registro novo começa com `spend.carried`, o gasto do dia e o teto que a conferência leu no antigo. Sem isso, a abertura seguinte só leria o registro novo e esqueceria o dia.
- **Registro de auditoria:**
  - `api.reserved`: antes de mandar;
  - `api.call`: resultado, status, id do pedido na Anthropic, uso, custo, se é estimado e duração;
  - `api.refused` e `api.over_budget`: no máximo um por minuto de cada, com a contagem dos que ficaram de fora;
  - `brain.ready`, `brain.exited`, `brain.failed` e `brain.gave_up`.
  - Nunca a chave nem o conteúdo.
- **Bloqueio e Cérebro caído:**
  - O bloqueio do Jesus (decisão 0019) interrompe todos os pedidos em andamento, e o Cérebro recebe `locked`.
  - Se o Cérebro cair, o que estava com ele é cancelado.
- **Variáveis de ambiente:** o principal registra no log os nomes das variáveis de ambiente que mudariam um `fetch` comum e que o transporte ignora (nunca os valores). O app de produção não abre com `NODE_*` fora de uma lista curta (seção 3.13): `NODE_DEBUG` imprimiria objetos internos no stderr, e `NODE_COMPILE_CACHE` carregaria código de fora do `app.asar`.

## Consequências

- **Onde a chave pode estar:** no cofre e, de passagem, na memória do principal, na hora de montar os cabeçalhos. Nunca no Cérebro, no ambiente dele, nas mensagens da ponte, no registro ou nos logs.
- **Testes:**
  - o caminho inteiro com o AI SDK de verdade;
  - o ambiente do Cérebro lido de `/proc/<pid>/environ`, com o app aberto num ambiente que traz uma chave falsa;
  - o transporte num processo com as quatro variáveis, no Node dos testes e no do Electron, com o `fetch` global como controle (ele obedece a elas).
- **O plano dizia "`fetch` do Node no principal".** A medição mostrou que ele obedece ao ambiente, e o transporte é o `https` com agente próprio.
- **Rede que só sai por proxy ou com inspeção de TLS** (rede de empresa, antivírus que abre o HTTPS): o Jesus não passa por ela, de propósito, e a conversa falha com `network`.
  - As autoridades aceitas são as da versão do Electron; atualizar o Electron as atualiza.
- **O teto é conservador:** perto do limite do dia, um pedido com contexto grande é recusado antes de um pequeno, porque a reserva conta o pior caso. A etapa 10 mostra isso na conversa.
- **Teto e gasto vêm do registro de auditoria:** quando o registro ganhar rotação (etapa 14), o arquivo novo precisa começar com o teto e o gasto do dia, ou a leitura da abertura precisa atravessar os arquivos.
- **O Cérebro não é barreira contra código rodando nele** (o utilityProcess não tem a sandbox do Chromium). Ele não tem chave, e as travas de rede pegam o caminho comum, não o código que já roda ali (que também lê e grava arquivos como o dono). As barreiras de verdade são a ausência da chave e a conferência do principal.
- **Atualizar o AI SDK** pode trazer campos novos no corpo, que a conferência recusa. O teste com o AI SDK de verdade pega isso antes de o app sair.
- **Fica para a etapa 10:** o laço da conversa, o histórico, os pontos de cache, a saída máxima pelo orçamento, a tela e um destino de teste para o teste de ponta a ponta da conversa.
  - **Corpo de 2 MB e a janela de contexto:** 2 MB são uns 500 mil tokens de texto, abaixo do limiar de compactação do contexto automático (85% de 1 milhão). A etapa 10 compacta também pelo tamanho do corpo (ou o limite sobe, com o custo da conferência).
  - **Raciocínio no histórico:** sem ferramentas, a conversa não precisa devolver os blocos de raciocínio. Com ferramentas (etapa 13), eles vão no laço sem edição (o Haiku 5.5 recusa histórico editado antes de um bloco), e cada um pesa 32.000 tokens na reserva. Se isso apertar o teto, a contagem exata de tokens da API (`count_tokens`) entra antes do pedido.
- **Revisão independente #3 (20/10/2026):** o que ela achou e a primeira versão deixava passar:
  - a chave inteira no stderr do principal com `NODE_DEBUG=https`, medido no Electron 44.7.0 com os fusíveis de produção;
  - um pedido cancelado enquanto a reserva gravava virava exceção solta, e a caixa de erro do Electron congelava o principal;
  - a conferência levava segundos (e mais de 1 GB) com um corpo de elementos inválidos;
  - só 4 dos 14 níveis do corpo tinham teste de campo desconhecido;
  - surrogates soltos dobravam o corpo que sai, e aninhamento fundo fazia a conferência lançar em vez de recusar;
  - uma conversa longa (corpo acima de 2 MB) derrubava o Cérebro até o supervisor desistir;
  - `worker_threads` e os módulos internos do `http` e do `tls` passavam pelas travas de rede do Cérebro;
  - o raciocínio devolvido não entrava no pior caso;
  - pôr o registro de lado zerava o gasto do dia na abertura seguinte.
  Cada um tem teste; os de segurança foram conferidos com a proteção desfeita (o teste falha).
- **`NODE_COMPILE_CACHE` (limite):** um programa que rode como o dono, grave a variável no ambiente do usuário e prepare uma pasta de cache faz o Node do principal rodar código de fora do `app.asar` antes de qualquer conferência do app, com os fusíveis ligados (medido no Electron 44.7.0). A recusa ao abrir não alcança esse caso, porque o código trocado é o do próprio início; é o mesmo limite da pasta de instalação gravável (decisão 0018). Fica para acompanhar: um fusível do Electron que desligue o cache e, na fase 3, a regra de negação do agente para mudar variáveis do usuário (`setx`, `HKCU\Environment`).

## Detalhes

`apps/desktop/src/main/egress/` · `apps/desktop/src/main/brain-process.ts` · `apps/desktop/src/main/supervisor.ts` · `apps/desktop/src/brain-host/` · `apps/desktop/src/bridge/brain-protocol.ts` · `apps/desktop/scripts/build.mjs` · seções [3.5](../03-seguranca.md), [3.12](../03-seguranca.md), [3.14](../03-seguranca.md), [3.15](../03-seguranca.md) e [3.16](../03-seguranca.md)
