# 0024 — Laço da conversa no Cérebro

- Status: aceita
- Data: 21/10/2026

## Contexto

A fase 1 conversa com o Claude Haiku 5.5 ([decisão 0011](0011-primeiro-modelo-claude-haiku.md)). Desde a etapa 9 ([decisão 0023](0023-cerebro-e-saida-para-a-api.md)), o Cérebro (`jesus-brain`) roda o AI SDK sem chave e sem rede, e cada pedido à API passa pela conferência do processo principal, que põe a chave do cofre e cobra do teto do dia.

O [plano da fase 1](../rascunhos/plano-fase-1.md) (etapa 10) pede o laço da conversa:
- `effort: 'medium'`;
- sem `temperature`, `top_p`, `top_k` nem resposta pré-escrita;
- `maxRetries: 0`;
- `maxOutputTokens` pelo orçamento;
- `allowSystemInMessages: true`;
- ponto de cache no prefixo e no fim do histórico;
- histórico só de acréscimo;
- `maskSecrets` uma vez ao entrar no histórico;
- conversa nova ao chegar no limite de contexto.

Dois fatos pesaram:
- **A revisão #3** confirmou na documentação da API que o Haiku 5.5 relê o raciocínio cifrado na assinatura dos blocos devolvidos, e o cobra como entrada pelo tamanho original. Por isso, a reserva do teto conta 32.000 tokens por bloco devolvido.
- **A pergunta 3 do plano** (histórico só na memória ou em arquivo cifrado) seguia aberta, com a proposta "só na memória".

## Decisão

- **Onde a conversa mora:** no Cérebro, uma por vez, só na memória (`brain-host/chat.ts`).
  - Fechar o app ou o Cérebro cair apaga a conversa.
  - A pergunta 3 do plano fica com a proposta até a fase da memória, que decide o que guardar (cifrado).
- **O caminho:** tela (servidor da interface) → principal → Cérebro, e a resposta de volta em pedaços.
  - As mensagens são conferidas com Zod estrito nas duas pontes (`bridge/chat-protocol.ts`):
    - interface → principal: `chat` (`get`, `send`, `stop`, `reset`); principal → interface: `chat-event`;
    - principal → Cérebro: `chat-*`, nos dois sentidos.
  - O principal só repassa e troca os `id` de um lado pelos do outro (`main/chat-relay.ts`):
    - um `id` que ele não mandou derruba o Cérebro (fuga do protocolo);
    - a resposta atrasada de um pedido que já terminou (corrida com o Parar) é ignorada;
    - um turno não passa de 1 milhão de caracteres de texto;
    - se o Cérebro cai, os pedidos com ele terminam com `brain`;
    - se o servidor da interface cai, os turnos que ele pediu param.
  - O servidor da interface encerra com `timeout` um turno sem nenhum evento em 5 min. A saída para a API já tem os próprios prazos; este é a última garantia de que a tela não espera para sempre.
- **Histórico:**
  - Só de acréscimo, e só com as trocas que terminaram.
  - Guarda o texto das respostas, **sem os blocos de raciocínio**. Numa conversa sem ferramentas, a API não exige devolvê-los, e devolvê-los custaria entrada e 32.000 tokens de reserva por bloco.
  - Como nenhum bloco é devolvido, nenhum fica inválido por mudança no histórico (o Haiku 5.5 recusa histórico editado antes de um bloco).
  - **Muda o plano**, que dizia guardar `response.messages` sem transformar.
  - Com ferramentas (etapa 13), os blocos voltam dentro do turno, sem edição, e saem do histórico quando o turno acaba.
- **A pergunta:** até 20 mil caracteres. Os segredos são mascarados uma vez (`maskSecrets`), ao entrar, e a pergunta já sai mascarada para o modelo. Pergunta vazia é recusada.
- **O pedido:**
  - `effort: 'medium'` e raciocínio adaptativo;
  - sem amostragem nem resposta pré-escrita;
  - `maxRetries: 0`: quem decide é a saída do principal, que cobra;
  - saída máxima de 32.000 tokens, o máximo que a conferência aceita;
  - pontos de cache nas instruções e na última pergunta;
  - `allowSystemInMessages` e download recusado.
- **As instruções:**
  - em pt-BR;
  - dizem que nesta versão o Jesus só conversa (não lê arquivos, não acessa a internet, não executa comandos);
  - mandam não dizer que fez o que não fez e não pedir segredos;
  - a data do dia entra uma vez por conversa, para não mudar o prefixo em cache.
- **Limite de contexto:** o orçamento do modelo (`computeContextBudget`, com o teto padrão do dia), uns 88,5 mil tokens no Haiku 5.5: 90% da faixa de preço de 100 mil, menos as instruções.
  - Antes de cada turno, o ocupado mais a pergunta estimada chegando ao limite dá `context_full`, e a tela pede uma conversa nova. Também no máximo 200 trocas.
  - O ocupado é a entrada medida na última resposta mais a saída dela. O raciocínio conta, mas não volta: sobra um pouco, para o lado seguro.
  - O plano dizia 80 mil, número do laboratório; o valor vem do mesmo algoritmo, com as instruções de verdade.
  - **O corpo nunca chega perto dos 2 MB** da conferência (88 mil tokens dão uns 350 KB), o que resolve a pendência da decisão 0023.
- **Fim do turno:** entra na conversa só com texto e fim `stop` ou `length`, e `length` avisa que a resposta foi cortada. Recusa do modelo (`refusal`), resposta sem texto, erro, Parar ou conversa trocada no meio: o turno não entra.
- **Os motivos de falha:**
  - os da saída para a API, como vieram;
  - pelo status da API: `api_auth` (401 e 403), `api_rate` (429), `api_overloaded` (5xx) e `api_invalid` (o resto);
  - `refusal`, `empty_answer`, `cancelled`, `stale` (a conversa da tela não é mais a do Cérebro), `turn_running`, `context_full`, `empty`, `brain` e `unavailable`.
- **Pedaços da resposta:** o Cérebro junta os pedaços do modelo a cada 30 ms, em partes de até 8.192 caracteres, sem partir um emoji ao meio.

## Consequências

- **Testes:**
  - o caminho inteiro com o AI SDK de verdade e respostas SSE gravadas: o pedido que sai (campos, cache, histórico sem raciocínio, segredo mascarado), cada motivo de falha, Parar, conversa nova, limite de contexto e Cérebro que cai no meio;
  - o repassador do principal e as duas pontes;
  - o protocolo, com Zod estrito.
- **A conferência do build:** com o `streamText` no Cérebro, o pacote `ai` passou a trazer uma mensagem de erro que cita o nome da variável da chave do gateway.
  - As marcas passaram a ser textos que só existem no cliente do gateway (o endereço, o cabeçalho de versão do protocolo e a leitura do token da Vercel), num arquivo só (`scripts/gateway-markers.mjs`) para o build e a conferência do pacote.
  - Conferido: sem o substituto, o build falha.
- **A conversa some ao fechar o app.** A fase da memória decide o que guardar.
- **O teto é conservador com conversas longas:** perto do limite, o corpo (uns 350 KB) passa da faixa de 100 mil na conta do pior caso, porque cada byte conta como um token. São uns US$ 0,28 reservados para um custo real de centavos.
  - Com o teto padrão de US$ 1, conversas longas são recusadas antes de as curtas, perto do fim do dia.
  - A contagem exata de tokens da API (`count_tokens`) pode entrar depois.
- **Sem tela ainda:** a etapa 11 liga a tela de conversa (streaming, Parar, Nova conversa; [decisão 0025](0025-tela-de-conversa.md)).

## Detalhes

`apps/desktop/src/brain-host/chat.ts` · `apps/desktop/src/brain-host/brain.ts` · `apps/desktop/src/bridge/chat-protocol.ts` · `apps/desktop/src/main/chat-relay.ts` · `apps/desktop/src/main/ui-server.ts` · `apps/desktop/src/main/brain-process.ts` · `apps/desktop/src/next-host/desktop-bridge.ts` · `apps/desktop/scripts/gateway-markers.mjs` · seção [3.5](../03-seguranca.md) e [3.15](../03-seguranca.md)
