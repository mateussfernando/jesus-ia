# 0017 — Servidor do Next num utilityProcess, falando com o principal por uma ponte

- Status: aceita
- Data: 15/10/2026
- Completa: a [0016](0016-nextjs-com-servidor-dentro-do-electron.md), que deixou para a fase 1 decidir onde o servidor do Next roda

## Contexto

A 0016 pôs o servidor do Next dentro do app, sem porta, e deixou para a fase 1 decidir, medindo, se ele roda no processo principal do Electron ou num `utilityProcess` só dele.

Medições de 12 e 13/10/2026 (protótipo com Electron 44.7.0 e Next 16.4, no Linux com xvfb):

- **Atraso de tecla na janela durante a conferência da senha** (bcrypt, custo 12): 92 ms com o Next no processo principal; 1 ms com ele num `utilityProcess`.
- **Memória:** de 40 a 60 MB a mais com o processo extra.
- **App empacotado:** com asar, fusíveis de produção e electron-builder 26.17.0, o `utilityProcess` carregou o build standalone do Next de dentro do `app.asar`. Funcionaram a tela de entrada, a Server Action que cria a senha, o pote de cookies e o início. Nenhuma pesquisa tinha provado essa combinação.

Limites encontrados no protótipo:

- o `protocol.handle` não guarda nem manda cookies (por isso o pote de cookies fica no principal);
- a resposta do Next precisa manter o streaming do RSC, com contrapressão;
- o repasse de Server Action entre páginas faz um `fetch` para a própria origem.

## Decisão

- **Onde roda:** o servidor do Next roda no `utilityProcess` `jesus-next`. O processo principal só encaminha os pedidos da janela.

- **Ponte** (`apps/desktop/src/bridge/protocol.ts`):
  - Cada pedido vai numa mensagem `request` com um `MessagePort` só dele. A resposta volta por esse port: `head`, `chunk`, `end` ou `error`.
  - Toda mensagem é conferida com Zod estrito dos dois lados. Uma mensagem fora do formato derruba o pedido (502) ou, no `parentPort`, o processo.
  - Limites:
    - corpo do pedido de até 2 MB (acima disso, 413);
    - até 128 cabeçalhos, somando 64 KiB (acima disso, 431);
    - só `https://jesus.invalid` e os métodos GET, HEAD e POST (o resto recebe 405);
    - pedaços de resposta de até 64 KiB;
    - no máximo 8 pedaços sem confirmação. Se a janela parar de ler, o Next para de produzir.

- **Configuração por mensagem, uma vez só:**
  - A pasta do build e a pasta de dados chegam numa mensagem `config`. Uma segunda mensagem `config` é recusada.
  - O ambiente do processo é montado por lista no principal (`child-env.ts`).
  - O próprio servidor põe no seu ambiente o que o Next e o `apps/ui` leem: `JESUS_HTTPS=1`, `JESUS_DATA_DIR` e a configuração gravada no build.

- **O servidor da interface não tem rede:**
  - O `fetch` global falha fechado.
  - A única exceção é o repasse de Server Action do próprio Next: um POST para `https://jesus.invalid` com `x-action-forwarded: 1`. Esse pedido é atendido em memória pelo mesmo servidor, com a barra final posta.
  - A página não pode mandar `x-action-forwarded`: o principal tira esse cabeçalho.

- **Falha fechada em tudo:**
  - Se o servidor não fica pronto em 10 s, o pedido recebe 503. A página de erro é do próprio principal: sem script (`default-src 'none'`) e se recarrega sozinha em 2 s.
  - Se o processo cai no meio de um pedido, a resposta é interrompida: sem cabeçalho, vira 503; com o corpo já começado, o corpo falha. Uma resposta truncada nunca chega como se estivesse inteira.
  - Sem cabeçalho de resposta em 30 s, 504.
  - **Vigia de vida:** com o servidor pronto, o principal manda um `ping` a cada 5 s pelo `parentPort`, e o servidor responde `pong` na hora. Sem resposta em 15 s (laço infinito, expressão regular catastrófica: vivo, mas preso), o processo é derrubado e segue o caminho de queda (sessão limpa, reinício, janela bloqueada). Antes disso, um servidor preso nunca saía: todo pedido esperava 30 s e recebia 504, para sempre.
  - O processo reinicia com espera (250 ms, 1 s, 3 s, 10 s). Depois de 5 quedas seguidas, o principal desiste e mostra uma página pedindo para abrir o Jesus de novo.
  - **Limite do Electron 44:** no `protocol.handle`, o `request.signal` nunca aborta (medido na revisão #2). A janela desistir de um pedido antes do cabeçalho não chega ao principal: o pedido segue até a resposta ou o prazo de 504. Já o cancelamento do corpo chega, e o servidor para de produzir. O código que trata o sinal fica (vale se uma versão nova passar a abortar).
  - O estado de acesso mora no servidor da interface, então o processo novo começa bloqueado. O principal limpa o pote de cookies quando sabe da queda (ligação na etapa 3).

- **Build do app:**
  - `JESUS_DESKTOP_BUILD=1` liga o `output: 'standalone'` do Next, rastreado a partir da raiz do repositório.
  - O `apps/desktop/scripts/stage-ui.mjs` monta a pasta que vai no app a partir desse build:
    - troca cada link simbólico por uma cópia (só segue links que apontam para dentro do build);
    - tira o `sharp` (as imagens não são otimizadas) e o `server.js` (ele abriria uma porta);
    - **recusa** `.env*`, `.jesus-dev`, `credentials*.json`, chaves, bancos, `.npmrc`, `.git` e módulos nativos. A montagem falha e lista o que achou. Isso importa porque o standalone do Next copia o `.env` do `apps/ui` para dentro do build.

- **Lista de `Host` no app:** com `JESUS_HTTPS=1`, o proxy aceita só `jesus.invalid` (127.0.0.1 e localhost recebem 421). Conferido com o build: o valor é lido quando o servidor roda, não fixado no build.

- **Testes:**
  - A ponte inteira roda em Node com falsos do IPC do Electron: entrega assíncrona, cópia estruturada e queda do processo.
  - Um teste de integração, que no CI roda depois do build, põe o servidor do Next de verdade (do build montado) atrás da ponte. Ele cobre: redirecionamento, CSP com nonce, Server Action que cria a senha com cookie `Secure`, repasse de ação, estáticos, a aba Cenários, bloqueio e `fetch` recusado.

## Consequências

- A janela não trava enquanto o Next trabalha (bcrypt, renderização), ao custo de 40 a 60 MB a mais.
- O `utilityProcess` não tem a sandbox do Chromium. Quem conseguir executar código no processo do Next ainda alcança a ponte e os arquivos do usuário. A separação protege contra travamento e vazamento por acidente, não contra execução de código. O que pede mais confiança (cofre e saída para a API) fica no principal (etapas 8 e 9).
- Dentro da sessão do Jesus, o `protocol.handle` não traz `Origin` nem `Sec-Fetch-*`, então a checagem de origem das Server Actions fica inerte. A proteção continua porque só documentos do próprio app rodam nessa sessão (etapa 3: guardas de navegação, vigia de quadros e CSP).
- O adaptador usa partes internas do Node (`_header`, `finished`, `_readableState`). O repasse de ação depende de `__NEXT_PRIVATE_ORIGIN`, que o Next marca para remoção. Por isso as versões ficam fixas, e o teste de integração acusa a quebra.
- A ponte congelada em `globalThis`, para o `apps/ui` falar com o principal (prevista no plano da fase 1), passou para a etapa 7, que traz o primeiro uso de verdade (eventos do Windows).

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seção 3.12) · [04-tecnologias.md](../04-tecnologias.md) (seção 4.4) · [plano da fase 1](../rascunhos/plano-fase-1.md) · `apps/desktop/src/bridge/` · `apps/desktop/src/next-host/` · `apps/desktop/src/main/ui-server.ts` · `apps/desktop/scripts/stage-ui.mjs`
