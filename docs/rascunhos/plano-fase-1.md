# Plano da fase 1 (rascunho de trabalho)

> Montado em 13/10/2026 por uma pesquisa em quatro frentes (requisitos nos documentos, protótipo do Electron sem porta, empacotamento e eventos/cofre), um planejador e um crítico de completude e segurança. Serve de roteiro para as sessões que implementam a fase 1; cada etapa vira um commit com testes e atualiza o [diário](../progresso.md). Quando uma etapa mudar uma decisão, ela registra a decisão em `docs/decisoes/` e corrige o documento afetado no mesmo commit.

**Critério de pronto** ([10.1](../10-roadmap.md)): o app abre pedindo a senha, conversa e lê arquivos de uma pasta liberada, com testes no CI; o `.exe` sem assinatura sai como artefato do CI.

## Topologia

| Processo | O que faz |
|---|---|
| **Principal** | Regras da janela (seção 3.12), cofre (`safeStorage`, DPAPI), saída para a API da Anthropic, único escritor do registro, `powerMonitor`, diálogos nativos. |
| **`jesus-next`** (utilityProcess) | Interface e estado de login; fala com o principal por um `MessagePort` validado com Zod `.strict()`. Medido: atraso de tecla de 1 ms durante o bcrypt (contra 92 ms com o Next no principal), +40 a 60 MB. |
| **`jesus-brain`** (utilityProcess) | Loop do AI SDK. Não vê a chave: o `fetch` dele vai ao principal, que confere o pedido e injeta o `x-api-key`. |
| **`jesus-executor`** (utilityProcess) | As três leituras, revalidadas pelas regras do `packages/gate`. |

Todos sobem com ambiente montado de uma lista explícita (sem segredos). A janela não tem preload nem porta: carrega `https://jesus.invalid/` numa partição em memória e **nunca usa `webRequest`** (no Electron 44.7.0, qualquer ouvinte de `webRequest` faz a página depois de um 3xx herdar a CSP do 3xx e quebra a tela de entrada).

## Etapas

| # | Etapa | Testável na nuvem? |
|---|---|---|
| 0 | **Feita em 13/10/2026.** `fix(ui)`: o `next dev` deixa de imprimir os argumentos das Server Actions (a senha aparecia no terminal). | sim |
| 1 | **Feita em 15/10/2026.** `apps/desktop` com o núcleo puro, testado em Node: adaptador em memória `Request` → `IncomingMessage`/`ServerResponse` → `Response` (streaming e contrapressão), pote de cookies, política de URL (só `https://jesus.invalid`), permissões (tudo negado), chaves de linha de comando por **lista branca** em produção, montador do ambiente dos filhos (nomes **sem diferenciar maiúsculas**, como no Windows). `productName: "Jesus"` fixo. | sim |
| 2 | **Feita em 15/10/2026.** Servidor do Next num utilityProcess, sem porta: protocolo da ponte (Zod), configuração por mensagem (nunca por ambiente), shim de `fetch` só para o repasse de Server Action, build `standalone` só com `JESUS_DESKTOP_BUILD=1`, `stage-ui` que recusa `.env*`, `.jesus-dev`, `credentials*.json`, links e `.node`. Lista de Host do app só com `jesus.invalid`. **Primeiro, provar o `jesus-next` em utilityProcess carregando o standalone de dentro do `app.asar` com os fusíveis ligados** (provado em 13/10/2026). Decisão 0017. A ponte congelada em `globalThis` (o `apps/ui` falando com o principal) passou para a etapa 7, o primeiro uso de verdade. | sim |
| 3 | **Feita em 15/10/2026.** Processo principal e janela com a seção 3.12: `setPath('userData')` **antes** de `requestSingleInstanceLock`; sandbox; sessão `jesus` sem persist com `protocol.handle` (https para o app, 403 para o resto; http e file 403); pote de cookies; proxy morto com `disable_non_proxied_udp`; permissões, downloads e captura negados; guardas de navegação, `window.open`, `webview`; vigia de quadros; `devTools: false` e menu próprio em produção; recusa rodar elevado no Windows; CSP com `frame-src`, `child-src` e `worker-src 'none'`; tirar CSP das respostas 3xx no handler. e2e no Linux com xvfb (CI com a sandbox do Chromium ligada). | sim (xvfb) |
| 4 | **Feita em 18/10/2026.** Empacotamento com electron-builder 26.17.0: standalone dentro do `app.asar`, fusíveis (RunAsNode, NODE_OPTIONS e `--inspect` desligados; integridade do asar e OnlyLoadAppFromAsar ligados), NSIS por usuário sem elevação. **Build de teste por constante de compilação** (código de teste fora do bundle de produção; teste com grep no `dist`). Decisão 0018 (cadeia do Electron, exceção dos binários do NSIS/7zip conferidos por hash). | Linux sim; NSIS só no Windows |
| 5 | **(adiantada) Feita em 18/10/2026** (falta o dono testar o `.exe` no PC dele). Job `windows-latest`: testes, e2e no `win-unpacked` de teste, NSIS, hash no resumo, artefato `jesus-windows-x64`; teste de adulteração do asar; um gatilho só (o PR #1 dispararia em dobro). | não (GitHub Actions) |
| 6 | `packages/shared` (`maskSecrets`, `wrapUntrusted`, `canonicalJson`), logger com redação e o escritor do registro (JSONL encadeado por SHA-256, **com âncora fora do arquivo** guardada pelo cofre, senão corte do fim e reescrita não são detectados). Decisão 0022. | sim |
| 7 | Ponte congelada em `globalThis` para o `apps/ui` falar com o principal (mensagens com Zod estrito, só as operações da lista). Eventos do Windows ligados ao bloqueio: `lock-screen` → OS_LOCKED; `suspend` e `resume` → SUSPEND; `getSystemIdleState` como segunda barreira; `seq` com confirmação (sem confirmação em 2 s, o `jesus-next` reinicia bloqueado); uso só por `input-event` real do principal; `JESUS_IDLE_MINUTES` só no build de teste. Decisão 0019. | com emissor falso |
| 8 | Cofre da chave (`safeStorage` síncrono; no Linux recusa `basic_text`/`unknown` e só aceita blob `v11`) e tela Configurações (Server Action → ponte → principal; recusa `sk-ant-admin`; o Next só vê a chave de passagem). Decisão 0020. | lógica sim; DPAPI só no Windows |
| 9 | `jesus-brain` e saída para a API pelo principal: destinos em lista fixa, **corpo conferido** (`model === 'claude-haiku-5-5'`, só ferramentas próprias, sem `mcp_servers`, `container`, `fallbacks` nem fontes por URL, teto de `max_tokens`, betas em lista fechada), cabeçalhos em lista, `redirect: 'error'`, teto de gasto do dia no próprio principal, cancelamento ao bloquear. Cliente HTTP: `fetch` do Node no principal (o `net.fetch` passaria pelo handler 403). No Cérebro: `experimental_download` que recusa, `fetch`/`WebSocket` globais que lançam, stub do `@ai-sdk/gateway`. | sim (transporte roteirizado) |
| 10 | Loop do chat com o Claude Haiku 5.5 (`ai` 7.0.x + `@ai-sdk/anthropic` 4.0.x, versões exatas com 3 dias ou mais): `effort: 'medium'`, sem `temperature`/`top_p`/`top_k`/prefill, `maxRetries: 0`, `maxOutputTokens` do orçamento, `allowSystemInMessages: true`, ponto de cache no prefixo e no fim do histórico, histórico só de acréscimo guardando `response.messages` sem transformar (blocos de raciocínio com `signature`; contas novas rejeitam histórico editado), `maskSecrets` uma vez ao entrar no histórico, limite de 80 mil tokens pede conversa nova, gasto do dia reconstruído do registro. Decisão 0023. | sim (SSE gravado) |
| 11 | Tela de conversa com streaming, Parar e texto seguro (Markdown restrito ou texto puro). | sim |
| 12 | `packages/gate` mínimo e determinístico: normalização de caminhos do Windows (seção 3.4.2), leitura só dentro das pastas liberadas, sensíveis e pastas do Jesus negadas (inclui `.jesus-dev` e `%APPDATA%\Jesus`), hardlinks (`nlink > 1`) negados, semente de `security/attack-corpus`. Decisão 0021. | lógica sim; junctions e 8.3 no Windows |
| 13 | `file.read`, `file.list`, `file.search` no `jesus-executor` (revalida com `realpath` + `fstat` comparando `dev`/`ino`; mascara segredos antes do `wrapUntrusted`; busca literal com corte forçado). Liberar pasta só pelo diálogo nativo, sem caminho vindo da página, com confirmação gerada por código e recusa de pastas amplas. | sim |
| 14 | Tela do Registro (exportação pelo principal com `showSaveDialog`) e fechamento da fase com um e2e do critério inteiro. | sim |

Pontos de **revisão independente** a recomendar ao dono (sem ligar): depois da etapa 3 (sessão, ponte, pote de cookies), depois das etapas 8 e 9 (cofre e saída com a chave) e depois da etapa 12 (regras de leitura).

## Riscos principais

- Dentro da sessão do Jesus o `protocol.handle` não traz `Origin`, `Sec-Fetch-*` nem CORS: a checagem de origem das Server Actions fica inerte. Defesa: só documentos do próprio app nessa sessão, CSP com nonce, guarda de navegação, vigia de quadros, sem iframe externo.
- O utilityProcess não tem sandbox: uma execução de código no processo do Next ainda alcança a ponte. A separação protege contra vazamento e travamento, não contra execução de código.
- Os fusíveis não cobrem `--remote-debugging-port`: o principal recusa chaves fora da lista branca.
- Partes internas do Next 16.4 e do Node usadas pelo adaptador podem mudar: versões fixas e e2e como guarda.
- O provedor do AI SDK lê `ANTHROPIC_API_KEY` e `ANTHROPIC_BASE_URL` do ambiente, e o `@ai-sdk/gateway` lê `AI_GATEWAY_API_KEY`: ambiente em lista, `baseURL` fixa e teste do `/proc/<pid>/environ`.
- DPAPI, eventos reais do `powerMonitor`, junctions, nomes 8.3, o NSIS e a sandbox do Chromium só no Windows (CI e PC do dono).

## Perguntas em aberto para o dono

1. O uso de qualquer programa do PC deve contar como uso do Jesus? (Proposta: não.)
2. Instalação por usuário (sem administrador, proposta) ou para todos os usuários, com UAC uma vez?
3. Histórico das conversas na fase 1: só na memória (proposta) ou em arquivo cifrado?
4. Saída de texto do modelo: Markdown restrito (+~60 pacotes) ou texto puro até a fase 8?
5. Busca em arquivos só literal (proposta) ou regex com motor linear?
6. Basta avisar ao liberar uma pasta que o conteúdo lido vai para a Anthropic, ou recusar pastas pessoais (Documentos, Downloads, Área de Trabalho)?
7. Frequência do job do Windows (minutos do Actions): todo push na `main-7zybuc` (proposta) ou só manual?
