# 0025 — Tela de conversa

- Status: aceita
- Data: 21/10/2026

## Contexto

Desde a etapa 10 ([decisão 0024](0024-laco-da-conversa-no-cerebro.md)), a conversa existe no Cérebro e chega até o servidor da interface pela ponte (`chat`), mas não há tela. O [plano da fase 1](../rascunhos/plano-fase-1.md) (etapa 11) pede uma tela com a resposta chegando em pedaços, o botão Parar e texto seguro, e deixa uma pergunta para o dono (a 4): Markdown restrito (mais uns 60 pacotes) ou texto puro até a fase 8.

Três fatos pesaram:
- **As Server Actions do Next não mandam a resposta em pedaços.** Para isso, o Next tem as rotas (`route.ts`), que devolvem um `Response` com corpo em streaming. Até aqui, o app só tinha páginas e Server Actions.
- **As rotas não têm a checagem de origem das Server Actions.** O cookie da sessão é `SameSite=Strict`, mas "mesmo site" não olha a porta: no desenvolvimento, uma página em `http://127.0.0.1:8080` é do mesmo site que o Jesus em `http://127.0.0.1:5173`, e o navegador mandaria o cookie. No app de desktop, a janela é a única que chega ao servidor, e os pedidos vêm sem `Origin` (seção 3.12).
- **Para testar a conversa inteira no app de verdade**, a saída para a API precisa de um destino que responda. O transporte só confia nas autoridades que vêm com o Node e só fala com `api.anthropic.com` ([decisão 0023](0023-cerebro-e-saida-para-a-api.md)); no Linux sem chaveiro, o cofre não guarda chave nenhuma.

## Decisão

- **Onde:** a conversa é a tela inicial (`/`), com atalhos para Cenários e Configurações. O botão Bloquear continua no canto.
- **Texto puro** (a pergunta 4 do plano):
  - a resposta entra na página só como texto (o React escapa tudo), com as quebras de linha como vieram;
  - sem Markdown, HTML, imagens nem links clicáveis.
  - Markdown restrito pode vir depois, com uma decisão nova e a revisão das dependências; o dono pode pedir.
- **O turno vai por uma rota:** `POST /api/conversa/` (`apps/ui/src/chat/turn-route.ts`).
  - Devolve uma linha JSON por evento (NDJSON): pedaços da resposta (`delta`) e, no fim, sempre `done` ou `error`.
  - Antes de tudo, a rota confere a origem (`apps/ui/src/server/same-origin.ts`):
    - `Sec-Fetch-Site`, se vier, tem de ser `same-origin`;
    - `Origin`, se vier, tem de bater com o `Host`;
    - o corpo tem de ser JSON (outra origem não manda JSON sem pedir licença antes, e a rota não dá licença).
  - Depois confere a sessão (mandar uma pergunta conta como uso fora do app de desktop) e o pedido (Zod estrito: a conversa e a pergunta de 1 a 20 mil caracteres; corpo até 128 mil caracteres).
  - **O turno só segue enquanto a sessão vale:** a rota confere a cada pedaço e a cada segundo. Bloqueou (botão, tempo sem uso, Windows), o turno para e a tela recebe `locked` e vai para a entrada. Antes, só o bloqueio do Windows parava a saída para a API.
  - A tela ir embora (navegar, fechar) também para o turno.
- **Parar, Nova conversa e o estado vão por Server Actions** (`app/(app)/chat-actions.ts`). O Parar usa um `stop()` novo na ponte, que para os turnos que aquele servidor da interface começou.
- **O que a tela faz em cada fim:**
  - a troca que terminou entra na tela na hora e, logo depois, a do Cérebro a substitui (com a pergunta já mascarada);
  - a pergunta que não entrou na conversa volta para o campo, para mandar de novo;
  - uma mensagem em pt-BR para cada motivo de falha (`apps/ui/src/chat/messages.ts`);
  - `length` avisa que a resposta foi cortada.
- **O vocabulário comum mora em `@jesus/core/chat`:** os motivos de falha da saída e da conversa, e o tamanho máximo da pergunta. O app de desktop e a interface usam a mesma lista, e o TypeScript exige uma mensagem para cada motivo.
- **Recarregar a página mostra a mesma conversa:** ela mora no Cérebro. Se um turno de antes ainda está em andamento, a tela confere o estado a cada 1,5 s e oferece o Parar.
- **Uso do limite:** em texto, "Conversa: N% do limite".
- **Destino de teste, só no build de teste** (`apps/desktop/src/main/test-api.ts`):
  - os testes de ponta a ponta apontam a saída para um servidor HTTPS local, com uma autoridade feita na hora e uma chave falsa (`__jesusTest.useTestApi`);
  - a conferência do pedido, o teto, o registro e o transporte de verdade continuam no caminho;
  - o build de produção não tem esse código. O nome `useTestApi` entrou nas marcas de código de teste (`scripts/test-markers.mjs`), que o build e a conferência do pacote procuram.

## Consequências

- **Testes:**
  - a rota do turno: pedaços, fim, origem, corpo, sessão, bloqueio no meio (com e sem pedaços chegando) e a tela indo embora;
  - a leitura das linhas na tela (cortes em qualquer byte, linha inválida, linha longa, corpo cortado);
  - o turno visto pela tela;
  - as mensagens: uma por motivo, e o TypeScript cobra uma para cada um;
  - a conferência de origem.
  - **Ponta a ponta no app de verdade (8):** sem chave, a resposta em pedaços, o pedido que sai (com a chave só no principal), recarregar a página, Parar (o pedido à API é interrompido e a reserva volta), o histórico na segunda pergunta, Nova conversa, bloquear no meio de uma resposta, a chave falsa fora da tela e dos arquivos, e nenhuma violação de CSP.
- **O dono já pode conversar:** guarda a chave em Configurações e pergunta na tela inicial.
- **A primeira rota do app** tem a própria conferência de origem; rota nova segue o mesmo caminho (`isSameOriginRequest` e `isJsonRequest`).
- **A conversa continua só na memória:** fechar o app a apaga (decisão 0024).
- **Sem confirmação no Nova conversa:** um clique apaga a conversa. Se incomodar, o dono pede.

## Detalhes

`apps/ui/src/chat/` (`ChatPanel.tsx`, `turn-route.ts`, `turn-client.ts`, `stream.ts`, `messages.ts`, `chat.css`) · `apps/ui/src/app/api/conversa/route.ts` · `apps/ui/src/app/(app)/chat-actions.ts` · `apps/ui/src/app/(app)/page.tsx` · `apps/ui/src/server/same-origin.ts` · `apps/ui/src/server/desktop-bridge.ts` · `packages/core/src/chat.ts` · `apps/desktop/src/next-host/desktop-bridge.ts` (`stop`) · `apps/desktop/src/main/test-api.ts` · `apps/desktop/src/e2e/chat.e2e.test.ts` · seção [3.12](../03-seguranca.md)
