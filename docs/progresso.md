# Progresso (diário de bordo)

> **Leia isto antes de qualquer tarefa** e atualize ao terminar cada etapa (o que foi feito, o que falta, onde parou). Serve para continuar o trabalho em outra sessão sem perder contexto. O resumo fixo do projeto está no [`CLAUDE.md`](../CLAUDE.md); aqui fica o **andamento**.

**Última atualização:** 21/10/2026, sessão na nuvem (trabalho feito na `ccr-d2d5ac72-nmmks6` e levado para a `main-7zybuc` com o aval do dono; veja "Branch" abaixo). **Fase 1 em andamento: etapas 0 a 11 feitas, e os achados da revisão independente #3 (etapas 8 e 9) corrigidos; a próxima é a etapa 12** (o Porteiro mínimo para leituras; seção "Fase 1: andamento"). **O chat de texto já funciona no app** (etapas 10 e 11): guardar a chave em Configurações e perguntar na tela inicial. A voz chega na fase 1.5. O `.exe` do CI espera o teste do dono no PC dele.

## Onde estamos

- **Fase 0 (holograma): concluída e aprovada** pelo dono do projeto. Ele mediu 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada; em GPU integrada ainda não foi medido.
- **Branch de trabalho: `main-7zybuc`** (PR #1: https://github.com/mateussfernando/jesus-ia/pull/1, CI verde). **Decisão do dono:** todo o trabalho fica nessa branch até o projeto ficar pronto; ele mesmo leva para a `main` no fim. Sessões novas devem partir dela e fazer commit e push nela; não fazer merge.
  - **Sessão de 10 a 12/10/2026:** a sessão na nuvem trabalhou na `ccr-d2d5ac72-nmmks6`, que saiu da `main-7zybuc` no `d940e18`. Em 12/10/2026, com o aval do dono, a `main-7zybuc` foi avançada até o fim dessa branch (avanço direto, sem merge e sem push forçado). **Autorização do dono (12/10/2026):** pode ir atualizando a `main-7zybuc` sem perguntar a cada vez; a `main` continua só com ele. **Próxima sessão:** parta da `main-7zybuc`. Se a sessão só puder enviar para outra branch, trabalhe nela em linha reta sobre a `main-7zybuc` e, ao fim de cada etapa (testes passando), avance a `main-7zybuc` até ela (`git push origin <branch>:main-7zybuc`), sempre por avanço direto: sem merge, sem rebase da `main-7zybuc` e sem push forçado. Se a `main-7zybuc` tiver andado por fora (não der avanço direto), pare e pergunte.
- **Stack nova (10/10/2026, pedido do dono):** interface em **React + Next.js + TypeScript** dentro do Electron, **Prisma** no PostgreSQL e **senha local com bcrypt** (dados cifrados com AES-256-GCM, porque bcrypt é hash e não tem volta). Decisões [0013](decisoes/0013-interface-em-nextjs-dentro-do-electron.md), [0014](decisoes/0014-prisma-como-orm.md) e [0015](decisoes/0015-senha-local-com-bcrypt-e-dados-cifrados.md). O dono escolheu, entre as opções: Next.js **dentro do Electron** (não só no navegador) e **senha local com bcrypt** para abrir o Jesus.
- **Próxima fase do roadmap:** terminar a fase 1 (Electron abrindo a janela com a interface em Next.js e a tela de entrada, chat por texto, 1 provedor, ferramentas só de leitura, registro) e, logo depois, a nova **fase 1.5: conversa por voz, só perguntas e respostas** (decisão 0012, pedido do dono). Ver `docs/10-roadmap.md`.

## Decisões tomadas nesta etapa

| Nº | Decisão |
|---|---|
| [0008](decisoes/0008-holograma-como-pacote-e-laboratorio.md) | Holograma como pacote próprio + laboratório web; TypeScript 6.0 |
| [0009](decisoes/0009-npm-em-vez-de-pnpm.md) | npm workspaces em vez de pnpm (pedido do dono), com `.npmrc` endurecido após revisão adversarial |
| [0010](decisoes/0010-primeiro-modelo-deepseek-via-deepinfra.md) | DeepSeek na DeepInfra — **substituída** pela 0011 (saiu mais cara que o esperado) |
| [0011](decisoes/0011-primeiro-modelo-claude-haiku.md) | **Cérebro = Claude Haiku 5.5** (~US$ 2/mês no uso típico; privacidade; 5× mais caro acima de 100 mil tokens por pedido) |
| [0013](decisoes/0013-interface-em-nextjs-dentro-do-electron.md) | **Interface em Next.js dentro do Electron**: exportação estática sem servidor, CSP com hashes; o laboratório vira a aba Cenários |
| [0014](decisoes/0014-prisma-como-orm.md) | **Prisma 7** no lugar do Drizzle; migrações em SQL aplicadas por um migrador próprio; a CLI (que baixa binário) só no desenvolvimento |
| [0015](decisoes/0015-senha-local-com-bcrypt-e-dados-cifrados.md) | **Senha local com bcrypt** (custo 12, até 72 bytes, código de recuperação) e **dados cifrados com AES-256-GCM** |

Descartado de vez: API direta do DeepSeek com dados pessoais (dados na China) e DeepSeek como Porteiro (baixa robustez a injeção).

## Em andamento: algoritmos automáticos

**Pedido do dono (palavras dele):**
- "quero que [o limite de contexto] seja automático dependendo do modelo de IA que estou usando";
- "os subagentes, memória e login deixe automático também, construa um algoritmo bom que fique da melhor forma, bem inteligente".

**Limites de segurança já combinados com o dono:** login é sempre feito por ele na página oficial (o Jesus só detecta a necessidade, pede confirmação e conduz o fluxo; seção 3.4.9 item 2); memória que o Jesus apenas deduz fica pendente até revisão (seção 3.10); subagentes passam pelo Porteiro na delegação e na volta.

**Feito:**
- Especificações dos 4 algoritmos em `docs/rascunhos/`. Cada uma foi escrita por um agente projetista; três já foram **reescritas por um agente crítico** (segurança, qualidade e testabilidade), com o que a crítica apontou no Apêndice C:
  - [Contexto automático por modelo](rascunhos/algoritmo-contexto.md) (revisado) → `packages/models` + `packages/core/src/context`
  - [Subagentes automáticos](rascunhos/algoritmo-subagentes.md) (revisado) → `packages/core/src/subagents` + checagens em `packages/gate`
  - [Memória automática](rascunhos/algoritmo-memoria.md) (revisado) → `packages/memory` (+ `maskSecrets`/`detectSensitive` em `packages/shared`)
  - [Login e conexão automáticos](rascunhos/algoritmo-login.md) (revisado em 10/10/2026, numa sessão própria; o que mudou fica no topo e a crítica no Apêndice C) → `packages/integrations/src/connect`

- **Limite de contexto automático: implementado** (commits `a87ac38` e seguinte).
  - `packages/models`: catálogo curado (Claude Haiku/Sonnet/Opus 5.5, preços oficiais de 08/10/2026), cartão conservador para modelo desconhecido, preço por faixa, custo exato em picodólares e estimativa de tokens. 18 testes.
  - `packages/core/src/context`: orçamento de contexto (tetos técnico, de qualidade, de custo e do usuário; degrau de preço; ponto ótimo de compactação pela fórmula do lote econômico) e o texto explicativo em pt-BR. 16 testes, que reproduzem os exemplos da especificação (Haiku 5.5 → 80 mil; Opus 5.5 → 73.705).
  - Laboratório: escolher o modelo muda o limite sozinho (Haiku 80 mil pelo degrau de preço; Sonnet e Opus 64 mil pelo orçamento do dia; desconhecido 15 mil); gastar mais aperta o limite. Os cenários usam frações do limite.
  - Correção em relação ao rascunho: a leitura de cache do Sonnet 5.5 é US$ 0,10 (página oficial), não 0,20.

- **Compactação automática: implementada** (commits `3532e68` e `afc1462`).
  - `packages/core/src/context`: limiares em pontos-base inteiros (`thresholds.ts`), limpeza de saídas antigas sem LLM com marcador gerado por código (`clearing.ts`), máquina de estados com resumo antecipado, reenchimento e disjuntor (`compaction.ts`), troca de modelo no meio da sessão (`planBudgetChange`) e notas do harness só com números (`notes.ts`). 52 testes novos (68 no pacote), que reproduzem os exemplos e casos do Apêndice B.
  - Laboratório: a mesma máquina roda sobre um histórico simulado. Limpa em 60%, avisa e começa o resumo antecipado em 75%, compacta sozinho em 85%. Novo cenário "Disjuntor da compactação"; botões "compactar agora" e "continuar". Trocar de modelo limpa ou compacta com o modelo atual antes. Conferido no Chromium.
  - Correção em relação ao rascunho: o piso do teto por passo é 256 tokens, não 512. Com 512, a garantia de dois passos de folga até o limite técnico falha entre L = 5.000 e 5.120.
  - Ainda **não** feito da seção 5: o resumo em si (`validateSummary`, `renderSummaryBlock`, `collectUserRequests`, `buildActionLedger`, `selectTail`, `deterministicCompaction`, hierárquica, `sanitizeModelText`), o corte de resultado (`truncateToolResult`), `speculativeStillValid` e o adaptador de histórico por provedor (seção 6). Dependem dos itens do histórico reais, do mascaramento de segredos (`packages/shared`) e do Porteiro; entram com a fase 1.

- **Contexto, parte 3: concluída** (commits `d539048` e seguinte).
  - `packages/models`: `usage.ts` (uso normalizado de Anthropic, DeepSeek e OpenAI; `checkReportedUsage`; `estimatedUsage`), `calibration.ts` (fator `k` em [0,5; 2] e margem por modelo), `ledger.ts` (livro de gastos: reserva antes, liquidação depois, reserva de segurança, dia local, `toHologramSpend`) e `usdPerMTokToPUsdPerToken` em `cost.ts`. Agora exportados no `index.ts`.
  - `packages/core/src/context`: `anchor.ts` (`contextUsage`, âncora no uso real) e `preflight.ts` (checagem antes de cada envio, falha fechada). Exportados.
  - Revisão em 3 lentes (especificação, robustez, segurança). Corrigido o que ela achou:
    - formato com nome do protótipo (`toString`) passava sem validação;
    - detalhe opcional inválido jogava fora o uso inteiro (agora vale 0 com anomalia);
    - total da DeepSeek com acerto + falta de cache que não bate cobra o maior;
    - `k` inválido desligava o piso contra uso informado baixo demais;
    - custo de entrada negativo virava saldo em `maxOutputForBudget`;
    - reserva com relógio no futuro nunca virava órfã;
    - âncora 0 ou `k` fora de [0,5; 2] faziam o preflight mandar contexto grande demais;
    - contagens absurdas davam NaN no uso (agora saturam).
  - Decisões (desvios conscientes da especificação): `reserveSpend` também recusa `duplicate_request` e `invalid_estimate`; `rollDay` zera o gasto das rotinas (a fatia é diária); `normalizeUsage` recebe o formato da API (o adaptador do AI SDK entra na fase 1, depois de conferir os tipos instalados); custo inválido nunca sai de graça (cobra a reserva).
  - 297 testes no projeto (108 em `core`, 113 em `models`, 42 no holograma, 34 no laboratório); lint, tipos e build limpos.

- **Crítica do rascunho de login: feita** (10/10/2026, commit `4f7333a`). Principais correções: contexto da conexão vem de registros confiáveis (nunca do Cérebro); reconexão de nível médio só quando o provedor derrubou a conexão; o código do device flow não vai para a área de transferência (ele autoriza a sessão para quem digitar primeiro); "Não sou eu" na primeira conexão; a ferramenta do modelo só pede leitura; toda conexão passa pela Camada 1; prazos em todos os estados das máquinas; fila como redutor puro. 15 perguntas com recomendação na seção 22.

## Feito em 10/10/2026: troca de stack (pedido do dono)

- `packages/crypto` (29 testes): `hashPassword`/`verifyPassword` com `bcryptjs` (custo 12, NFC, recusa acima de 72 bytes em vez de cortar e recusa a senha certa seguida de mais bytes além do 72º), códigos de recuperação de 100 bits (base32 de Crockford) e `sealField`/`openField` (AES-256-GCM, dado autenticado com tabela, coluna e linha; id de chave para trocar a chave).
- `packages/auth` (31 testes): regras da senha (`checkNewPassword`), espera progressiva (5 livres, depois 30 s dobrando até 15 min), máquina de bloqueio (`lockTransition`: inatividade, bloqueio do Windows, suspensão; cancela cartões e fluxos de conexão) e o serviço (`createAuthService`: criar, desbloquear, trocar, recuperar), com repositório em memória para testes.
- `packages/db` (14 testes, 6 contra PostgreSQL de verdade): Prisma 7.10, tabela `app_credentials` com restrições (uma linha, só hashes bcrypt) e privilégios (`jesus_app` sem acesso, `jesus_config` sem `DELETE`), migrador próprio com soma de verificação, repositório com contagem atômica. `prisma generate` sem baixar binário.
- `apps/ui` (39 testes): o laboratório saiu do Vite para o Next.js 16 (`/cenarios/`), mais início (`/`) e tela de entrada (`/entrar/`, demonstração em memória no navegador). CSP rígida com hashes dos scripts inline; Zod sem JIT; telemetria do Next desligada. Conferido no Chromium: sem violação de CSP; criar a senha leva ~0,9 s; 5 erros pedem 30 s; a recuperação respeita a mesma espera.
- CI: PostgreSQL com pgvector como serviço (testes do banco) e artefato `interface` no lugar de `hologram-lab`.
- 376 testes no projeto; lint, tipos e build limpos.

## Feito em 11/10/2026: back-end no Next.js (pedido do dono)

- O dono explicou por que quis o Next.js: **front-end e back-end num lugar só, com o sistema de rotas**. A exportação estática (0013) desligava isso. [Decisão 0016](decisoes/0016-nextjs-com-servidor-dentro-do-electron.md): o `apps/ui` agora é um app Next.js com servidor; no app instalado, o Electron entrega os pedidos da janela do Jesus ao servidor do Next dentro do próprio app, **sem abrir porta** (provado num teste: página, redirecionamento e Server Action atendidos por um adaptador em memória).
- Login no servidor: Server Actions (`app/entrar/actions.ts`, `app/(app)/actions.ts`), sessão por cookie `HttpOnly`/`SameSite=Strict` com só o SHA-256 guardado, `requireUnlocked()` em cada página protegida, botão "Bloquear" e sinal de uso, credencial num arquivo JSON (troca atômica, falha fechada se adulterado) até a fase 4.
- CSP com nonce a cada pedido (`src/proxy.ts`), sem `unsafe-inline`; saíram o passo de hashes e o modo de demonstração no navegador.
- Conferido no Chromium contra o `next start`: sem sessão vai para a entrada; código de recuperação aparece; cookie com as flags certas; Cenários abre; página protegida recusada com o app bloqueado; Server Action forjada de outra origem recusada sem contar tentativa; nenhuma violação de CSP.
- Revisão independente (ultracode, pedida pelo dono) de `packages/crypto`, `packages/auth`, `packages/db` e do back-end do Next: resultado e correções em "Feito em 12/10/2026".

## Feito em 12/10/2026: correções da revisão independente

Duas revisões com verificação adversarial (cada achado reproduzido por um segundo agente): 22 achados confirmados, 9 incertos e 23 derrubados. Todos os confirmados e os incertos com caminho real foram corrigidos, cada um com teste novo; 427 testes no projeto, lint, tipos e build limpos.

- **Alto (interface):** o sinal periódico da página aberta contava como uso, e o bloqueio por tempo sem uso nunca disparava com a janela visível. Agora a conferência periódica (`checkSession`) não conta como uso; só tecla, clique ou rolagem chamam `touch`, numa cadência de um quarto do tempo sem uso (no máximo 30 s). Conferido no Chromium com 1 min de limite: a página parada vai para a entrada em 75 s; um usuário ativo por 100 s não é bloqueado.
- **Médio (banco):** o migrador aceitava `BEGIN`/`COMMIT` dentro do arquivo (o `prisma migrate dev` gera isso para `enum`), o que gravaria metade da migração sem registrá-la e travaria o banco. Agora recusa antes de aplicar (checagem do texto) e confere o id da transação depois de rodar o arquivo. A trava consultiva passou para antes da criação da tabela de controle (6 instâncias num banco novo: uma aplica, as outras esperam).
- **Relógio que volta** (dual boot, correção de hora): a espera da senha é reancorada no instante atual (`anchorFailureClock` nos três repositórios); o bloqueio por inatividade conta de agora; o estado de acesso do servidor usa um relógio que nunca volta.
- **Login local:** `setupPassword` não abre sessão com o app bloqueado; um bloqueio que chega durante a conferência da senha vence (`UNLOCKED` leva o `since` visto no começo); `lockNow` confere a sessão; setup simultâneo devolve `busy`; auditoria com a operação e espera registrada uma vez só; o runtime que falhou ao montar tenta de novo no pedido seguinte.
- **Senha:** recusa U+0000 (o bcrypt repete a senha em ciclo: "senha\0senha" passava), caracteres de controle, trechos repetidos de qualquer tamanho, senhas só de símbolos ou emoji e sequência decrescente que dá a volta. `openFieldText` preserva o BOM.
- **Servidor da interface:** lista de `Host` no proxy contra *DNS rebinding* (421; também com `next-router-prefetch`, que antes pulava o proxy); o proxy confere tudo menos `/_next/static/`; telas próprias de 404 e de erro geral, sem violação de CSP; gravação do arquivo da senha com `fsync` e nova tentativa da troca de nome no Windows.
- **PostgreSQL ligado ao servidor da interface:** com `JESUS_DATABASE_URL`, a senha vai para `app_credentials` pelo repositório Prisma (`@jesus/db/client` e `/credentials`, carregados só nesse caso; a variável sai do ambiente do processo depois de lida). `npm run db:apply -w @jesus/db` aplica as migrações. Conferido com `next start`: senha criada no banco (custo 12) e lida de novo depois de reiniciar. No app (`JESUS_HTTPS=1`), `JESUS_DATA_DIR` ou `JESUS_DATABASE_URL` é obrigatória.
- **Ferramentas:** `db:migrate:create` gera a migração sem aplicar (para completar à mão antes), e a CLI do Prisma roda com a telemetria desligada.
- **Ficou como decisão de desenho (documentado, sem código):** a espera da senha é uma só para o app, então quem alcança a tela de entrada consegue impor a espera ao dono; por isso só a janela do Jesus pode alcançá-la (seção 3.20). Em desenvolvimento, programas do próprio PC alcançam a porta local.
- **Segunda revisão, só das correções** (3 revisores e um verificador por achado): 7 problemas confirmados, todos corrigidos com teste novo e conferidos no `next start` (435 testes no projeto; lint, tipos e build limpos):
  - **Alto:** com o banco fora do ar no primeiro pedido, a nova tentativa já não achava `JESUS_DATABASE_URL` (apagada do ambiente) e caía para o arquivo, oferecendo "Crie a senha" (contornava a senha do dono). Agora o repositório é escolhido uma vez por processo; com o banco fora, o servidor fica fechado (500) e volta para "Desbloquear" quando o banco volta.
  - Migrador: o leitor de SQL diverge menos do PostgreSQL (comentário até `\r`, identificador e tag de dollar quote com acento, `standard_conforming_strings` fixado em cada arquivo); a segunda barreira virou uma marca `SET LOCAL`, que não quebra arquivo começando com `SET TRANSACTION`.
  - Auditoria: a espera é registrada uma vez por operação (alternar desbloquear e recuperar enchia a auditoria). Senha: uma letra repetida entre símbolos (`x!@#x$%^x&*(`) voltou a ser recusada.
  - Página aberta: o sinal de uso mede o tempo com o relógio monotônico (com o relógio voltando 1 h, o usuário ativo não é mais bloqueado); bloqueado, a tela de entrada abre com carga completa. "Tentar de novo" na tela de erro recarrega de verdade.
- O verificador da área "Server Actions" não terminou (limite de uso). Os 6 achados dela foram conferidos à mão contra o código: 3 repetiam achados confirmados, 2 foram corrigidos (`lockNow` sem sessão e a cadência do sinal de uso) e 1 é a decisão de desenho acima.

## Fase 1: andamento

Roteiro: [plano da fase 1](rascunhos/plano-fase-1.md). Cada etapa é um commit com testes; a `main-7zybuc` avança junto.

- **Etapa 0 (13/10/2026):** o `next dev` parou de imprimir os argumentos das Server Actions (a senha aparecia no terminal); `logging.serverFunctions: false`, com teste.
- **Etapa 1 (15/10/2026):** `apps/desktop` com o núcleo puro, testado em Node: adaptador em memória `Request` → Node → `Response` (streaming e contrapressão), pote de cookies (o `protocol.handle` não guarda cookies), políticas de URL e permissões, linha de comando por lista branca em produção, ambiente dos filhos por lista (nomes sem diferenciar maiúsculas, como no Windows).
- **Etapa 2 (15/10/2026):** servidor do Next no utilityProcess `jesus-next`, sem porta ([decisão 0017](decisoes/0017-servidor-do-next-num-utilityprocess.md)).
  - Prova antes do código (13/10): app empacotado (asar + fusíveis de produção) carregando o build standalone de dentro do `app.asar` num utilityProcess; entrada, criação da senha, pote de cookies e início funcionaram.
  - `src/bridge/`: protocolo com Zod estrito (configuração uma vez só; pedido só para `https://jesus.invalid`, GET/HEAD/POST, corpo até 2 MB; resposta em pedaços de até 64 KiB com janela de 8 créditos) e falsos do IPC do Electron para os testes.
  - `src/next-host/`: o lado do servidor (configuração por mensagem, `fetch` que falha fechado menos o repasse interno de Server Action com a barra final) e a entrada do utilityProcess.
  - `src/main/ui-server.ts`: o lado do principal (sobe, reinicia com espera de 250 ms a 10 s, desiste depois de 5 quedas seguidas; páginas próprias de 503/502/504 sem script; pedido em andamento é interrompido se o processo cair; tira `x-action-forwarded` da página).
  - `apps/ui`: `JESUS_DESKTOP_BUILD=1` liga o build standalone; com `JESUS_HTTPS=1`, o proxy aceita só `jesus.invalid` (conferido no build: 127.0.0.1 e localhost recebem 421, e sem a variável a máquina local continua aceita).
  - `scripts/stage-ui.mjs`: monta `apps/desktop/stage/ui` (1.267 arquivos, 28 MB), sem links, sem sharp e sem `server.js`; recusa `.env*`, `.jesus-dev`, credenciais, chaves, bancos e módulos nativos (conferido: com um `.env.production`, a pasta `.jesus-dev` e um link para fora, a montagem falha e lista os três).
  - Testes: 53 novos de unidade no `apps/desktop` (91 no pacote) e 2 no `apps/ui` (ponte inteira com processo falso que cai e reinicia, servidor que foge do protocolo, contrapressão de ponta a ponta) e 10 de integração com o servidor do Next de verdade do build montado (no CI, depois do build).
  - Ficou para depois: a ponte congelada em `globalThis` (o `apps/ui` falando com o principal) passou para a etapa 7; o Electron em si (janela, `protocol.handle`, pote de cookies ligado) é a etapa 3.
- **Etapa 3 (15/10/2026):** processo principal e janela com a seção 3.12 (`apps/desktop/src/main/index.ts`, `app-session.ts`, `app-window.ts`, `app-protocol.ts`).
  - Dependências novas (versões exatas, todas com mais de 3 dias): `electron` 44.7.0 (sem script de instalação; o binário vem de `node node_modules/electron/install.js`, conferido pelo `checksums.json`), `rolldown` 1.2.12 (já estava no lockfile, pelo Vite) e `playwright-core` 1.64.0 (a 1.64.1 tinha 1 dia).
  - `scripts/build.mjs` empacota com o rolldown: `dist/` (produção) e `dist-test/` (teste). A constante `__JESUS_TEST_BUILD__` é de compilação; o build de produção falha se sobrar código de teste (a trava achou na primeira vez o nome da variável dos testes numa mensagem de erro).
  - O que roda: `setPath('userData')` antes da trava de instância única; sandbox; partição em memória `jesus` com `protocol.handle` (https do app → servidor da interface; o resto, `http:` e `file:` → 403); sessão padrão trancada igual; proxy morto; permissões, dispositivos, captura, downloads e corretor negados; guardas de navegação, `window.open` e `webview`; vigia de quadros; sem DevTools e sem menu; recusa abrir como administrador no Windows (`whoami`); CSP com `frame-src`, `child-src` e `worker-src 'none'`; tira a CSP das respostas 3xx no handler.
  - 11 testes de ponta a ponta (`src/e2e/`) com o Electron de verdade sob xvfb, passando aqui (como root, com `--no-sandbox`) e no CI com a sandbox ligada. Achados dos testes:
    - um `iframe` `srcdoc` com sandbox passa pela CSP (`frame-src 'none'` não se aplica: nada é buscado) e pela guarda de navegação; quem pega é o vigia de quadros, que derruba a sessão (conferido);
    - sem GPU, o WebGL do holograma só sobe com `--enable-unsafe-swiftshader` (só nos testes);
    - o `_electron.launch` do Playwright não serve: conecta antes da troca inicial de processo da janela (que usa uma partição própria), recebe `Inspector.targetCrashed` e nunca entrega a página. O harness abre o Electron, conecta pelo CDP depois que a página carregou (`connectOverCDP`) e pelo inspetor do Node no processo principal.
  - 14 testes de unidade novos (102 no `apps/desktop`): `app-protocol` (pote de cookies, 403, CSP no 3xx), `paths`, `elevation`.
  - CI verde no `2c170cb` (com a sandbox do Chromium ligada; o primeiro envio falhou só porque o teste do holograma contava avisos de desempenho do WebGL como erro).
- **Revisão independente das etapas 1 a 3 (15 a 18/10/2026): incompleta.** O ultracode estava ligado e a revisão rodou com 4 revisores e verificação adversarial, mas todos pararam no limite de uso: dois ("processos e build" e "testes") mal começaram, e o da "ponte" pesquisou sem concluir. O revisor da "janela" deixou uma sonda com o app de verdade, cujas saídas foram aproveitadas dos registros:
  - barrados (conferido): `mailto:` com dados na URL, `ms-settings:`, `meta refresh` para fora, navegação para `blob:`, download, iframe sem `src` com sandbox (pego pelo vigia);
  - **corrigido:** a página principal levada para `about:blank` (por script ou `meta refresh`) não era pega por nada (herda a origem do app). O vigia agora exige endereço do app no quadro principal (`isAllowedCommittedFrame`);
  - **corrigido:** o vigia pulava uma violação que viesse menos de 2 s depois da anterior (o teste novo mostrou a página parada em `about:blank`). Agora toda violação age, e um disjuntor fecha o app com mais de 8 em 10 s;
  - **corrigido:** `loadURL` rejeitado ficava sem tratamento, e uma abertura interrompida fechava o app (`app.exit(1)`). No Electron 44, rejeição sem tratamento no principal só gera aviso (conferido);
  - defesa a mais: cabeçalhos `x-prerender-*` (revalidação sob demanda do Next) não vêm da página.
  - **Recomendação ao dono:** rodar de novo a revisão independente das etapas 1 a 3 (ponte, processos e build, testes) quando ele ligar o ultracode; ela gasta bastante do limite.
- **Etapa 4 (18/10/2026):** empacotamento com electron-builder 26.17.0 ([decisão 0018](decisoes/0018-empacotamento-com-electron-builder.md)).
  - `electron-builder.config.cjs`: só o bundle (`dist/` ou `dist-test/`) e a interface montada, dentro do `app.asar`, sem `node_modules` do projeto (o `zod` passou para `devDependencies`, porque vai no bundle). Download do Electron conferido pelo `checksums.json`. Fusíveis travados na produção; padrão no build de teste. NSIS de um clique, por usuário, sem elevação. Linux: pasta `linux-unpacked` (para o CI).
  - `scripts/package.mjs [--test] [--win|--linux]` e `scripts/check-package.mjs`: fusíveis um a um, conteúdo do `app.asar` (bundle certo, nada de `dist-test` na produção, nada que o `stage-ui` recusaria, nenhum código de teste) e, abrindo o app de produção, saída 2 com `--remote-debugging-port` e `ELECTRON_RUN_AS_NODE` ignorado.
  - Conferido aqui: fusíveis do pacote de produção (48/49 no binário); como usuário comum (`tester`, com a sandbox ligada), o app recusou os argumentos e não rodou como Node. A contraprova vale: o Electron de desenvolvimento, sem fusíveis, roda como Node com `ELECTRON_RUN_AS_NODE=1`. Os 12 testes de ponta a ponta passaram também no pacote de teste, com a interface de dentro do `app.asar`.
  - Dependências: 248 pacotes novos, todos de desenvolvimento e com 3 dias ou mais (o `min-release-age` garante); só o `electron-winstaller` tem script de instalação, recusado em `allowScripts`. `@electron/fuses` 1.8.0 e `@electron/asar` 3.4.1 explícitos (já estavam na árvore). O `npm audit` passou a acusar 8 alertas moderados do `sprintf-js` (cadeia de download do electron-builder; ferramenta de build) além dos 4 altos da CLI do Prisma.
  - CI: o job do Linux empacota e confere a produção e roda os testes de ponta a ponta no pacote de teste. O instalador `.exe` (NSIS) e o teste de adulteração do asar ficam para o job `windows-latest` da etapa 5.
  - CI verde no `4e1473c`: no runner (usuário comum), a conferência abriu o app de produção e viu a recusa; os 12 testes de ponta a ponta passaram no pacote de teste, com a sandbox ligada.
- **Etapa 5 (18/10/2026, CI verde no `75b8901`):** job `windows` no `.github/workflows/ci.yml` (mesmo gatilho do job do Linux: cada envio para a branch do PR roda os dois uma vez; o repositório é **público**, então os minutos do Windows não pesam no limite do Actions, e a pergunta 7 do plano fica com a proposta). O job:
  1. roda os testes de unidade e de integração;
  2. gera o pacote de teste (`--dir`) e roda nele os testes de ponta a ponta;
  3. gera o instalador NSIS de produção e o confere;
  4. roda o teste de adulteração do `app.asar` (`scripts/tamper-check.mjs`: a cópia intacta sai com 2 diante de um argumento recusado, e a adulterada não pode rodar o código do app);
  5. põe o SHA-256 do instalador no resumo (`scripts/installer-summary.mjs`) e publica o artefato `jesus-windows-x64`.
  - Os runners Windows do GitHub rodam como administrador: o build de teste só registra a elevação e segue (o de produção recusa abrir). O harness passa no Windows as variáveis do sistema (`SystemRoot` e afins), sem elas nem a conferência de administrador roda.
  - O `.exe` do artefato fica baixável por qualquer conta do GitHub (repositório público). Ele não leva segredo nenhum.
  - Ajustes até ficar verde: caminhos de dentro do `app.asar` com o separador do Windows (`\`) no `@electron/asar`; no fim dos testes de ponta a ponta, o app sai por `app.quit()` (no Windows, o `kill` deixava os auxiliares do Chromium segurando a pasta de dados, e apagá-la dava `EBUSY`; e, com o inspetor do Node conectado, o processo espera o depurador sair, então o inspetor fecha logo depois do pedido).
  - Resultado no `windows-latest`: 12 testes de ponta a ponta no pacote de teste; pacote de produção conferido abrindo o app (recusa de argumentos e do `ELECTRON_RUN_AS_NODE`); adulteração do `app.asar` barrada (intacto: saída 2; adulterado: saída 1, sem rodar o código do app). O teste de adulteração troca um byte de um **comentário** do `dist/main.mjs` (sem a integridade, o app rodaria igual e sairia com 2).
  - Primeiro instalador: `Jesus-Setup-0.1.0.exe`, SHA-256 `65b933af08cb1028293f25808619bf58f27bcae7a77fb4ee968792f44914e369` (run 39165456027; cada envio gera um novo, guardado por 14 dias).

- **Revisão independente #2 das etapas 1 a 5 (18 e 19/10/2026): parcial.** Rodou com o ultracode ligado; os revisores da "ponte" e de "processos e build" terminaram, o da "janela" deixou as notas, o de "testes" mal começou e nenhum verificador rodou (limite de uso). Sem verificador, cada achado foi conferido aqui antes da correção. 16 achados (5 médios):
  - **corrigido (janela-4, médio):** `ELECTRON_DISABLE_SANDBOX` no ambiente desligava a sandbox de todas as páginas no app de produção (conferido como usuário comum: `Seccomp: 0` no processo da página). Os fusíveis não cobrem essa variável e a recusa de argumentos só olhava o `argv`. Agora a produção recusa as variáveis `ELECTRON_*` que o executável lê (saída 2), aceita só as sem efeito e as de ferramentas de build (`src/main/policy/electron-environment.json`; o `check-package.mjs` confere no binário que ele não lê estas) e liga a sandbox sem condição. O ambiente desta nuvem tem `ELECTRON_GET_USE_PROXY` (do `@electron/get`), por isso as de build ficam aceitas;
  - **corrigido (janela-2, médio):** `<link rel="dns-prefetch">` da página resolvia o nome no DNS do sistema, apesar do proxy morto (canal de vazamento por DNS). `--host-resolver-rules=MAP * ~NOTFOUND`: nenhum nome resolve pelo Chromium; teste de ponta a ponta com `resolveHost` (esta nuvem não tem DNS, então o teste só morde no CI);
  - **corrigido (janela-1, médio):** um `beforeunload` da página (com ativação do usuário, que a senha digitada já dá) cancelava a volta ao início pelo vigia e o fechamento da janela. `will-prevent-unload` sempre liberado; o teste novo falha sem a correção;
  - **corrigido (janela-3, baixo):** a lista de violações crescia sem teto na produção, com a URL inteira (até 2 MB cada). Só o build de teste guarda, cortada.
  - **corrigido (processos-build-1, médio):** `package.mjs --test` sem `--dir` gerava no Windows um instalador do build de teste com o appId, o nome e o nome de arquivo da produção, que ocuparia a instalação de verdade com um app sem fusíveis. Agora `--test` exige `--dir`, o build de teste tem identidade própria (`dev.jesus.desktop.test`, "Jesus (teste)"), a configuração recusa qualquer instalador ou pacote dele (`artifactBuildStarted`; conferido pedindo um zip) e o `check-package --test` confere o nome e a falta de instalador;
  - **corrigido (processos-build-2, baixo):** o Next tenta `require('@opentelemetry/api')` antes da cópia embutida, e a busca saía do `app.asar` até `resources/node_modules` (conferido: um módulo plantado ali rodava no `jesus-next`). O servidor da interface trava a busca de módulos na raiz do app (`module.registerHooks`, `src/next-host/module-scope.ts`). O teste de ponta a ponta no pacote planta o módulo: falha sem a trava e passa com ela;
  - **corrigido (processos-build-4, baixo):** a chave das Server Actions do build ia igual em todo `.exe`; agora é aleatória por processo (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`). As de pré-visualização ficam (sem uso no app; registrado na seção 3.13);
  - **corrigido (processos-build-6, baixo):** o `package.mjs` conferia a primeira pasta `*-unpacked` que achasse; agora limpa a saída antes e confere a da plataforma pedida;
  - **corrigido (processos-build-7, baixo):** o `check-package` também recusa o que a montagem deixaria de fora (sharp, `server.js`) e qualquer binário (`.node`, `.dll`, `.exe`, `.so`, `.dylib`) no `app.asar`;
  - **corrigido (processos-build-8, baixo):** as ações do GitHub ficam fixadas pelo commit (`checkout` v5.1.0, `setup-node` v5.0.0, `upload-artifact` v4.6.2), não pela tag móvel.
  - **corrigido (ponte-1, médio):** um `jesus-next` vivo mas preso (laço infinito) nunca era derrubado: todo pedido esperava 30 s e recebia 504, para sempre. Agora há um vigia de vida (`ping`/`pong` pelo `parentPort` a cada 5 s, prazo de 15 s) que derruba o processo e segue o caminho de queda. O teste com o processo preso falha sem o vigia. Um corpo que para de chegar com o servidor vivo continua aberto até a janela desistir (uma resposta em streaming pode ter pausas longas, como a do chat);
  - **corrigido (ponte-2, baixo):** no adaptador, um status ou cabeçalho que o Fetch não aceita (103, 600, quebra de linha) deixava o pedido pendurado; agora vira 500 seco. E `end()` depois de `destroy()` lançava `ERR_INVALID_STATE` (corrida entre o cancelamento e o fim do Next); agora só devolve;
  - **corrigido (ponte-3, baixo):** a resposta do adaptador não tinha socket, e o `send` dos estáticos do Next só fecha o arquivo pelo `close` do socket: cada estático cancelado no meio deixava um arquivo aberto (conferido com o Next de verdade: 5 cancelamentos, 5 descritores). A resposta usa o socket do pedido, destruído quando a janela desiste, e marca `res.closed`. Teste de integração com os descritores (no Linux);
  - **corrigido (processos-build-3, baixo):** o caminho do `whoami` vinha da variável `SystemRoot`, que o usuário pode redefinir (HKCU\Environment): aberto como administrador, o Jesus rodaria elevado o `whoami` que ela apontasse. Agora a pasta do sistema vem do link do núcleo `\\?\GLOBALROOT\SystemRoot\System32`, resolvido para o caminho de verdade. O teste de unidade no Windows confere o caminho, e o de ponta a ponta confere que a conferência rodou (o build de teste registra `elevação: elevated` no runner). Abrir a produção sem argumentos no CI esperando a saída 3 não dá: ela mostra um aviso antes de sair, e o aviso trava o runner;
  - **corrigido (processos-build-5, baixo):** a pasta de dados era `%APPDATA%\Jesus` (Roaming, padrão do Electron), mas a documentação e a regra de negação da seção 3.4.3 falam em `%LOCALAPPDATA%\Jesus`. Agora é `%LOCALAPPDATA%\Jesus` (por máquina, como o Chromium), e a regra de exemplo também nega a instalação (`%LOCALAPPDATA%\Programs\Jesus`). **Para o dono:** se já instalou o primeiro `.exe` e criou a senha, ela ficou em `%APPDATA%\Jesus`; o app atualizado pede uma senha nova, e aquela pasta pode ser apagada;
  - **corrigido (ponte-4, baixo):** o falso do IPC agora imita o Electron 44.7.0 nos três pontos medidos (`close()` local emite `close`; `kill()` antes do `spawn` não faz nada; o `exit` chega antes das mensagens pendentes dos ports), com testes. O principal agora derruba o processo quando ele sobe, se o `kill()` veio cedo demais. No `protocol.handle`, o `request.signal` nunca aborta: o cancelamento antes do cabeçalho não existe no app (registrado na decisão 0017; o pedido segue até a resposta ou o 504).

- **Etapa 6 (19/10/2026):** `packages/shared` e o registro de auditoria ([decisão 0022](decisoes/0022-registro-de-auditoria-e-mascaramento.md)).
  - `canonicalJson` com os vetores do rascunho do login; `maskSecrets` (chaves com prefixo, Bearer, JWT, PEM, senha em URL, senha por atribuição e por proximidade, códigos de verificação e de login, CVV, cartão pelo Luhn, alta entropia), idempotente por construção (mascara de novo até nada mais ser achado; testado em 400 textos aleatórios); `escapeForPrompt`/`wrapUntrusted` (tira tags Unicode, largura zero e controles de direção; `<` e `>` de largura total); logger com redação (campos com nome de segredo saem inteiros).
  - Registro: JSONL com SHA-256 do JSON canônico encadeado, âncora `{ seq, hash }` fora do arquivo, `fsync` antes de a âncora avançar, linha incompleta no fim cortada e registrada, arquivo adulterado posto de lado como prova e registro novo ligado à última âncora boa (`audit.chain_broken`); a primeira linha só começa do zero ou religa assim (cortar o começo aparece).
  - No app: o principal usa o logger (formato `[jesus] nível evento {campos}`), a saída do `jesus-next` passa pelo `maskSecrets`, e o registro (`%LOCALAPPDATA%\Jesus\data\audit.jsonl`) guarda abertura, eventos do servidor da interface, violações da janela, disjuntor e página caída. A âncora fica por enquanto em `audit-anchor.json` ao lado (provisória; vai para o cofre na etapa 8). Nada é gravado se o app abrir elevado.
  - A frase-semente (BIP-39) ficou para a memória automática (precisa das listas de palavras).
  - Cuidado encontrado: a ferramenta de escrita de arquivos troca as sequências `\uXXXX` por caracteres invisíveis de verdade. Arquivo com escape Unicode se escreve por script (Python ou heredoc) e se confere com uma varredura de invisíveis.
  - Testes: 74 no `packages/shared`, 2 da âncora em arquivo, e 1 de ponta a ponta (o registro do app confere com a âncora e tem os eventos de segurança; 14 no total, também no pacote de teste).

- **Etapa 7 (19/10/2026):** bloqueio pelos eventos do Windows e ponte do servidor da interface com o principal ([decisão 0019](decisoes/0019-bloqueio-pelos-eventos-do-windows.md)).
  - Ponte congelada em `Symbol.for('jesus.desktop.bridge')` no `jesus-next` (`next-host/desktop-bridge.ts`), posta antes de o Next carregar o `apps/ui`; um ouvinte de cada (`onLock`, `onActivity`). O `apps/ui` (`server/desktop-bridge.ts`) confere a forma antes de usar; sem ela (`next dev`), nada muda.
  - Mensagens novas com Zod estrito: `lock` (`os_locked`/`suspend`, com `seq`), `activity` e `lock-ack`. O servidor confirma depois de aplicar.
  - No principal (`main/lock-signals.ts` + `index.ts`): `lock-screen`, `suspend` e `resume` bloqueiam; `getSystemIdleState` a cada 15 s como segunda barreira. Cada bloqueio apaga o pote de cookies, avisa o servidor (sem confirmação em 2 s, ele é reiniciado bloqueado), volta a janela para a entrada e vai para o registro (`app.locked`).
  - Uso de verdade só pelo `input-event` da janela (teclas, cliques, rolagem, toque), avisado no máximo a cada 5 s. No app, o `touch` da página só confere a sessão.
  - `JESUS_E2E_IDLE_MS` só no build de teste (a trava do build também procura esse nome). A política do `@jesus/auth` ganhou `minIdleMs` (padrão 1 min, nunca abaixo de 1 s), que só a ponte do build de teste baixa.
  - Achado no caminho: o `ui-server.ts` mandava a configuração só com as duas pastas e descartava campos novos; agora manda a configuração inteira.
  - Testes: protocolo, ponte e servidor (bloqueio confirmado, bloqueio que falha não é confirmado, uso, ponte congelada), sinais de bloqueio com relógio falso, estado de acesso e runtime com a ponte falsa, piso do tempo sem uso; ponta a ponta: tela bloqueada, suspensão e volta levam à entrada com o pote vazio e sem reinício por falta de confirmação; e um arquivo novo (`idle.e2e.test.ts`) com prazo de 4 s, em que teclas de verdade mantêm o app aberto e eventos criados pela página não adiam o bloqueio.

- **Etapa 8 (19/10/2026):** cofre da chave e tela Configurações ([decisão 0020](decisoes/0020-cofre-da-chave-no-processo-principal.md)).
  - Cofre no principal (`main/vault.ts`): `vault.json` na pasta de dados, cada valor cifrado pelo `safeStorage` síncrono; recusa sem cifra, no Linux com `basic_text`/`unknown` e blob que não seja `v11`; arquivo conferido com Zod estrito; troca atômica.
  - Pedidos do servidor da interface pela ponte (`vault` com `id` → `vault-reply`): status, guardar e apagar a chave. O principal confere a forma de novo (`checkAnthropicKey` em `packages/shared`: só `sk-ant-apiNN-…`, recusa `sk-ant-admin…`) e registra `vault.key_saved`/`key_removed`/`key_refused`, sem a chave.
  - Tela `/configuracoes/` (com atalho no início): campo de senha que se esvazia no envio; a resposta diz só se há chave guardada.
  - A âncora do registro passou para o cofre, com migração da âncora em arquivo (vale uma vez; a primeira gravação vai para o cofre e apaga o arquivo). Sem cofre (Linux sem chaveiro), fica no arquivo.
  - Corrigido junto (etapa 7): abrir uma página contava como uso (`requireUnlocked`); no app, não conta mais, e o teste de tempo sem uso agora também pede páginas sem parar.
  - Testes: cofre com `safeStorage` falso, pedidos ao cofre, âncora no cofre com migração, ponte do cofre (servidor, principal, protocolo), validação da ponte e mensagens no `apps/ui`, forma da chave; ponta a ponta: a chave de administrador é recusada, a chave falsa é guardada e apagada (no Windows) ou recusada pelo cofre (no Linux sem chaveiro), e ela não aparece na tela, na saída do principal nem em nenhum arquivo da pasta de dados.

- **Etapa 9 (19/10/2026):** Cérebro num utilityProcess e saída para a API pelo principal ([decisão 0023](decisoes/0023-cerebro-e-saida-para-a-api.md)).
  - **Medido antes do código:** no Electron 44.7.0, o `fetch` do Node e o agente global do `https` obedecem a `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA` (com `SSL_CERT_FILE`), `NODE_TLS_REJECT_UNAUTHORIZED=0` e `NODE_USE_ENV_PROXY` com `HTTPS_PROXY`. Um `https.request` com agente próprio, autoridades explícitas e `rejectUnauthorized: true` não obedece a nenhuma. Por isso o transporte é esse, e não o `fetch` que o plano citava.
  - **Dependências:** `ai` 7.0.142 e `@ai-sdk/anthropic` 4.0.81 (as 7.0.143 e 4.0.82, anotadas antes, ainda não tinham 3 dias), no `apps/desktop`. Nove pacotes novos, nenhum com script de instalação: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/gateway`, `@ai-sdk/provider`, `@ai-sdk/provider-utils`, `@vercel/oidc`, `@workflow/serde`, `eventsource-parser` e `json-schema` (o `undici` já estava na árvore). O `@jesus/models` entrou como dependência do app.
  - **Cérebro (`src/brain-host/`):**
    - travas antes do AI SDK: `fetch`/`WebSocket`/`EventSource` que lançam, módulos de rede do Node e `undici` recusados (ganchos de módulo e `getBuiltinModule`), `process.binding` fora;
    - modelo com endereço fixo, chave de mentira e o `fetch` da ponte;
    - download que recusa;
    - `@ai-sdk/gateway` trocado no build por um substituto (o build e a conferência do pacote procuram o código dele).
  - **Ponte:** mensagens `api-*` com `id`, Zod estrito. O supervisor novo (`main/supervisor.ts`, o mesmo desenho do servidor da interface) sobe o Cérebro, vigia com `ping`/`pong`, derruba quem foge do protocolo e reinicia.
  - **Saída (`src/main/egress/`):**
    - conferência do pedido por lista branca (destino, cabeçalhos, betas, corpo: modelo, `max_tokens` até 32.000, streaming, só ferramentas próprias, sem imagem nem URL); o corpo que sai é o conferido, serializado de novo;
    - chave do cofre na hora;
    - reserva do pior caso no teto do dia (US$ 1 por padrão) e `api.reserved` no registro antes de mandar;
    - transporte com autoridades fixas, 3xx como falha e prazos;
    - pedaços copiados para o Cérebro;
    - liquidação pelo uso lido do SSE.
    - O bloqueio interrompe tudo (`locked`).
    - O gasto do dia é refeito pelo registro ao abrir (o plano deixava isso para a etapa 10). A conferência da cadeia do registro ganhou um visitante para isso.
  - **Achado no caminho:** um `Buffer` do Node pode ser fatia do reservatório compartilhado, e mandá-lo inteiro por mensagem levaria o reservatório junto (com os cabeçalhos da chave, em tese). A saída copia cada pedaço; o teste falha sem a cópia.
  - **Testes:** 125 novos no `apps/desktop` (276 no pacote) e 2 no `packages/shared`.
    - Conferência do pedido (46 casos), leitor do SSE, teto e reconstrução, saída com transporte roteirizado (recusas, bloqueio, cancelamento, corte, resposta grande, cópia dos pedaços) e chave do cofre.
    - Transporte com TLS de verdade (autoridade de teste feita na hora em Node puro, sem `openssl`), com redirecionamento, prazos, corte e cancelamento.
    - O ambiente sem efeito no transporte, num processo à parte, com o `fetch` como controle; também no Node do Electron, entre os testes de ponta a ponta.
    - As travas do Cérebro, num processo à parte.
    - O caminho inteiro com o AI SDK de verdade: a chave só aparece na saída, `container` e `mcpServers` são recusados, imagem por URL não sai, modelo por nome cai no substituto do gateway e o bloqueio corta no meio.
    - Ponta a ponta (20 no total, também no pacote de teste): o app aberto com uma chave falsa e variáveis de proxy e TLS no ambiente; o ambiente do Cérebro e do `jesus-next` (lido de `/proc/<pid>/environ`) não tem nada disso; o Cérebro volta sozinho se cair; o registro tem `brain.ready` e `brain.exited`.
  - **Conferido aqui:** lint, tipos, todos os testes, integração, ponta a ponta no build de teste e no pacote de teste, e a conferência do pacote de produção como usuário comum.
  - **Para o dono:** o teto padrão é US$ 1 por dia (dez vezes o uso típico estimado). Ele pode pedir outro valor, e uma configuração pode vir na tela.

- **Teto configurável (19/10/2026, pedido do dono):** o teto de gasto do dia agora se muda na tela Configurações, de US$ 0,01 a US$ 100,00 (padrão US$ 1).
  - Ponte nova `spend`/`spend-reply` (Zod estrito), do servidor da interface ao principal; a ponte congelada ganhou `spend.status()` e `spend.setDailyLimit()`.
  - O principal (`main/spend-requests.ts`) confere a faixa, grava `spend.limit_set` no registro de auditoria (com o valor anterior) e só então aplica; sem registro, nada muda. Na abertura, o teto é o último `spend.limit_set` válido do registro.
  - A tela mostra o gasto do dia (com o que está em andamento) e o teto; o texto sai pronto do servidor.
  - Testes: protocolo, ponte nos dois lados (inclusive resposta de outro tipo com o mesmo id), pedidos no principal, teto no livro e na reconstrução, formato e mensagens na tela; ponta a ponta: valor fora da faixa recusado, valor novo vale na hora no principal e vai para o registro.
- **Revisão independente #3 das etapas 8 e 9 (19 a 21/10/2026, ultracode ligado pelo dono):** sobre o código congelado no `6e10014`. Oito revisores planejados (caminho da chave, cofre, conferência do pedido, transporte, teto, Cérebro, tela Configurações, testes), céticos para cada achado e um crítico de completude. **O limite de uso acabou duas vezes no meio:** terminaram os revisores da chave, do cofre, da conferência, do transporte e do Cérebro (20 achados); os do teto, da tela e dos testes, os céticos e o crítico não rodaram. Cada achado recebido foi reproduzido aqui (sonda ou teste) e corrigido, com teste; os de segurança foram conferidos com a proteção desfeita (o teste falha). O que mudou (decisões 0020, 0022 e 0023; seções 3.5, 3.12, 3.13, 3.15 e 3.16):
  - **Chave no stderr com `NODE_DEBUG=https` (o mais grave; dois revisores, provado no Electron com os fusíveis de produção):** o transporte põe os cabeçalhos com `setHeader`, depois de criar o pedido; o app de produção não abre com `NODE_*` fora de uma lista curta (`NODE_DEBUG`, `NODE_DEBUG_NATIVE`, `NODE_COMPILE_CACHE`…); a sonda do ambiente roda com `NODE_DEBUG=*` e procura a chave na saída; a conferência do pacote abre o app com essas variáveis.
  - **Pedido cancelado enquanto a reserva gravava:** virava exceção solta, e a caixa de erro do Electron congelava o principal. Agora nem sai, não é cobrado, e o transporte não abre conexão para pedido já cancelado.
  - **Cofre e âncora:** a âncora saiu do `vault.json` para um arquivo cifrado próprio (`audit-anchor.vault`), com migração das duas versões anteriores; gravação durável (`durable-file.ts`: `fsync` antes da troca de nome e novas tentativas curtas no Windows); âncora ilegível vale como ausente e o registro sempre abre; cofre estragado vai para o lado quando o dono guarda ou apaga a chave (`vault.reset`); chave que não abre mais aparece como "guarde de novo"; até 20 gravações por minuto e recusas no registro uma vez por minuto.
  - **Gasto do dia através da quarentena:** `spend.carried` leva o gasto e o teto para o registro novo.
  - **Conferência do pedido:** custo limitado (listas medidas antes, elementos parando no primeiro erro, até 64 níveis e 250 mil valores; antes, de 1 a 8 s e mais de 1 GB por pedido inválido); sai o resultado do esquema; tamanho conferido no que sai; surrogates soltos recusados; teste de campo desconhecido em cada um dos 16 objetos.
  - **Ritmo do Cérebro:** mais de 10 pedidos em 5 s, ou mais de 3 recusas pela lista num minuto, derrubam o Cérebro.
  - **Conversa longa:** corpo acima de 2 MB é recusado no próprio Cérebro (`too_large`), em vez de derrubá-lo até o supervisor desistir.
  - **Travas do Cérebro:** `worker_threads`, as peças internas do `http` e do `tls` e o `process.dlopen` agora também recusam.
  - **Raciocínio devolvido no pior caso:** pela documentação da API, o Haiku 5.5 lê o raciocínio cifrado na assinatura e o cobra como entrada pelo tamanho original; cada bloco devolvido reserva 32.000 tokens a mais.
  - **Teste do nome no certificado** (desligar a conferência de nome passava por todos os testes).
  - **Tela Configurações:** espaço entre as seções (pedido do dono) e "Apagar chave" também quando a chave não abre.
  - **Limite registrado:** `NODE_COMPILE_CACHE` com uma pasta preparada roda código de fora do `app.asar` antes de qualquer conferência (precisa de um programa rodando como o dono; mesmo limite da pasta de instalação gravável). Para a etapa 10: o corpo de 2 MB (uns 500 mil tokens) é menor que o limiar de compactação do contexto (85% de 1 milhão).
  - **Conferido aqui:** lint, tipos, todos os testes (333 no `apps/desktop`), integração, ponta a ponta no build de teste (21) e a conferência do pacote de produção como usuário comum (recusa `NODE_DEBUG` e `NODE_COMPILE_CACHE`).
  - **Falta da revisão #3:** os revisores do teto, da tela Configurações e dos testes, e um crítico das correções. Recomendar ao dono rodar só isso numa sessão nova, se ele quiser gastar o limite.
- **Chave de teste na nuvem (pergunta do dono):** dá para testar com uma chave real pelos "Segredos de rede" do ambiente (nunca pelas variáveis de ambiente, que ficam visíveis e entram no ambiente dos processos). Nesta nuvem, o TLS para `api.anthropic.com` é refeito pelo proxy (medido: a cadeia não vem de uma autoridade pública), e o transporte do app recusa isso de propósito. O teste com a API de verdade precisa de um roteiro só de teste, fora do app, que confie na autoridade do proxy; faz sentido depois da etapa 11 (com a tela de conversa), numa sessão nova (o segredo só vale em sessão nova).
- **Etapa 10 (21/10/2026):** laço da conversa no Cérebro ([decisão 0024](decisoes/0024-laco-da-conversa-no-cerebro.md)).
  - **Cérebro (`brain-host/chat.ts`):** uma conversa por vez, só na memória (a proposta da pergunta 3 do plano).
    - Pergunta de até 20 mil caracteres, mascarada uma vez ao entrar (`maskSecrets`); pergunta vazia é recusada.
    - Pedido: `effort: 'medium'` com raciocínio adaptativo, sem amostragem nem resposta pré-escrita, `maxRetries: 0`, saída máxima de 32 mil tokens, pontos de cache nas instruções e na última pergunta, download recusado.
    - Instruções em pt-BR: nesta versão o Jesus só conversa; não diz que fez o que não fez; não pede segredos; a data entra uma vez por conversa.
    - O turno só entra no histórico com texto e fim `stop` ou `length`; recusa do modelo, resposta vazia, erro, Parar e conversa trocada no meio não entram.
    - Pedaços da resposta juntados a cada 30 ms, em partes de até 8.192 caracteres, sem partir um emoji.
  - **Desvios do plano:**
    - o histórico guarda só o texto das respostas, **sem os blocos de raciocínio** (sem ferramentas, a API não exige devolvê-los, e cada bloco devolvido custaria entrada e 32 mil tokens de reserva no teto);
    - o limite de contexto vem do orçamento do `packages/core`, uns 88,5 mil tokens com as instruções de verdade, e não os 80 mil do laboratório; também no máximo 200 trocas.
    - Com esse limite, o corpo do pedido fica em uns 350 KB, longe dos 2 MB da conferência (a pendência anotada na revisão #3).
  - **Caminho:** tela → servidor da interface → principal → Cérebro, e os pedaços de volta.
    - Mensagens com Zod estrito nas duas pontes (`bridge/chat-protocol.ts`).
    - O principal só repassa (`main/chat-relay.ts`): troca os `id`, derruba o Cérebro que responde a um `id` que não pediu ou com o tipo errado, ignora resposta atrasada de um pedido já terminado, corta um turno acima de 1 milhão de caracteres, termina com `brain` os pedidos de um Cérebro que caiu e para os turnos de um servidor da interface que caiu.
    - A ponte congelada do `jesus-next` ganhou `chat` (`state`, `reset`, `send` com ouvinte e `stop`); turno sem nenhum evento em 5 min termina com `timeout`.
  - **Motivos de falha** com nome próprio, para a tela dar a mensagem certa: os da saída para a API, os do status da API (`api_auth`, `api_rate`, `api_overloaded`, `api_invalid`) e os da conversa (`refusal`, `empty_answer`, `cancelled`, `stale`, `turn_running`, `context_full`, `empty`, `brain`, `unavailable`).
  - **Achado no caminho:** com o `streamText` no Cérebro, o pacote `ai` passou a trazer uma mensagem de erro que cita o nome da variável da chave do gateway, e o build recusava o Cérebro. As marcas do gateway viraram textos que só existem no cliente dele (endereço, cabeçalho de versão do protocolo, leitura do token da Vercel), num arquivo só (`scripts/gateway-markers.mjs`) usado pelo build e pela conferência do pacote. Conferido: sem o substituto do gateway, o build falha.
  - **Testes:** 34 novos no `apps/desktop` (367 no pacote).
    - O caminho inteiro com o AI SDK de verdade, a saída do principal e respostas SSE gravadas (17): o pedido que sai (campos, cache, histórico sem raciocínio, segredo mascarado), cada motivo de falha, Parar, conversa nova, conversa trocada, limite de contexto e Cérebro que cai no meio.
    - O repassador do principal (7), o protocolo (5) e as pontes do servidor da interface e do Cérebro.
  - **Conferido aqui:** lint, tipos, todos os testes, build de produção e de teste, ponta a ponta no build de teste (21) e o pacote de produção.
  - **Ainda sem tela:** a etapa 11 liga a conversa na interface.
- **Etapa 11 (21/10/2026):** tela de conversa ([decisão 0025](decisoes/0025-tela-de-conversa.md)).
  - **Onde:** a tela inicial (`/`) virou a conversa, com atalhos para Cenários e Configurações.
  - **Texto puro** (resposta à pergunta 4 do plano; o dono pode pedir Markdown depois): a resposta entra só como texto, com as quebras de linha, sem Markdown, HTML, imagens nem links clicáveis.
  - **Turno por rota** (`POST /api/conversa/`, a primeira rota do app): a resposta volta em pedaços, uma linha JSON por evento.
    - A rota confere a origem sozinha (`Sec-Fetch-Site` e `Origin` quando vêm, corpo JSON), a sessão e o pedido (Zod estrito). Motivo: as rotas não têm a checagem de origem das Server Actions, e o `SameSite=Strict` não olha a porta.
    - **O turno para quando o Jesus bloqueia por qualquer motivo** (botão, tempo sem uso, Windows): a rota confere a sessão a cada pedaço e a cada segundo. A tela ir embora também para o turno.
  - **Parar, Nova conversa e o estado** por Server Actions; a ponte ganhou `chat.stop()`.
  - A pergunta que não entrou na conversa volta para o campo; uma mensagem em pt-BR para cada motivo de falha; o uso do limite em texto; recarregar a página mostra a mesma conversa.
  - **O vocabulário comum** (motivos de falha, maior pergunta) foi para `@jesus/core/chat`, usado pelo app de desktop e pela interface (o TypeScript cobra uma mensagem para cada motivo).
  - **Destino de API de teste** (`apps/desktop/src/main/test-api.ts`), só no build de teste: os testes de ponta a ponta apontam a saída para um servidor HTTPS local com autoridade feita na hora e chave falsa. Conferido: o build de produção não tem esse código, e as marcas de código de teste ficaram num arquivo só (`scripts/test-markers.mjs`), usado pelo build e pela conferência do pacote.
  - **Testes:** 24 novos no `apps/ui` (109 no pacote), 2 no `packages/core` e 1 no `apps/desktop` (368). **Ponta a ponta (29 no total, 8 novos):** sem chave, resposta em pedaços, o pedido que sai com a chave só no principal, recarregar, Parar (o pedido à API é interrompido e a reserva volta ao teto), o histórico na segunda pergunta, Nova conversa, bloquear no meio de uma resposta, a chave falsa fora da tela, da saída e dos arquivos, e nenhuma violação de CSP.
  - **Conferido aqui:** lint, tipos, todos os testes, build da interface para o app, montagem, build de produção e de teste, ponta a ponta no build de teste e o pacote de produção.
  - **Para o dono:** no app, guardar a chave da API em Configurações e perguntar na tela inicial. Cada pergunta passa pelo teto do dia (US$ 1 por padrão).

**Falta (nesta ordem):**
1. **Fase 1, conforme o [plano da fase 1](rascunhos/plano-fase-1.md)** (14 etapas, montado em 13/10/2026 por pesquisa, planejador e crítico): Electron (`apps/desktop`) com o servidor do Next num utilityProcess, sem porta; empacotamento e `.exe` no `windows-latest`; registro; eventos do Windows; cofre da chave; Cérebro e saída para a API; chat com o Claude Haiku 5.5; Porteiro mínimo para leituras; ferramentas de leitura; tela do registro. **Feito:** etapas 0 a 11 e as correções da revisão #3 (veja "Fase 1: andamento"). **Próxima:** etapa 12 (o `packages/gate` mínimo e determinístico para leituras: caminhos do Windows normalizados, só pastas liberadas, sensíveis e pastas do Jesus negadas, hardlinks negados, semente do `security/attack-corpus`; decisão 0021). Recomendar ao dono a revisão independente depois dela (regras de leitura). **Pendente do dono:** testar o `.exe` do artefato `jesus-windows-x64` no PC dele. As revisões independentes #1, #2 e #3 ficaram incompletas (limite de uso; os achados que vieram foram corrigidos).
2. Depois da fase 1: memória (com `detectSensitive` em `packages/shared`) → login automático de contas → subagentes. Ligar cada um ao holograma e trocar os controles manuais correspondentes do laboratório por simulação automática.
3. Promover as quatro especificações a documentação oficial (seções em `docs/02`, `05`, `06`, `09`), com decisão registrada se mudar algo já decidido.

**Pedidos do dono que valem para as próximas fases:**
- Aba **"Cenários"** no app, com o laboratório do holograma, da fase 1 até a final (seção 8.8; na fase 10 ele decide se sai).
- Fase **1.5**: conversa por voz, só perguntas e respostas, antes do Porteiro (decisão 0012).
- Tela **"Permissões"**: tudo que ele liberou, com remoção a qualquer hora (seção 3.4.7). Inclui as capacidades de contas conectadas (rascunho de login, seção 4.2).
- **Stack:** React + Next.js + TypeScript, Prisma, bcrypt na senha local (decisões 0013 a 0015).
- Recomendar o ultracode só quando valer (regra no `CLAUDE.md`); preferir sessão nova por etapa.
- **Login (12/10/2026):** o dono considerou o NextAuth (Auth.js) e escolheu **manter o login próprio** (decisões 0015 e 0016). Motivo apresentado: o NextAuth v5 ainda é beta e está só em manutenção de segurança desde que passou para a equipe do Better Auth; o login próprio já passou por duas revisões independentes. Não reabrir sem pedido dele.
- **Autonomia (12/10/2026):** seguir trabalhando sozinho e só parar quando ele precisar decidir algo ou fazer algo à mão (testar no Windows, criar conta, colar chave). O limite de uso às vezes acaba no meio; ele retoma a sessão depois. Por isso: commit e push a cada passo que passa nos testes, e o diário sempre em dia.

## Pendências do dono do projeto

- **Testar o instalador do CI no PC (fase 1, etapa 5)** (use o da execução mais recente: a pasta de dados mudou para `%LOCALAPPDATA%\Jesus` em 19/10/2026; se já tinha instalado um anterior, a senha criada nele fica em `%APPDATA%\Jesus` e pode ser apagada): no PR #1, aba *Checks* (ou *Actions*), abrir a execução mais recente do CI, baixar o artefato `jesus-windows-x64` e descompactar. Conferir o hash no PowerShell (`Get-FileHash .\Jesus-Setup-0.1.0.exe`, comparando com o resumo da execução) e instalar. O SmartScreen avisa porque não há assinatura: "Mais informações" → "Executar assim mesmo". Conferir: instala sem pedir administrador; abre na tela "Crie a senha do Jesus"; criar a senha e anotar o código; a aba Cenários com o holograma (fps); "Bloquear"; fechar e abrir de novo pede a senha; abrir "como administrador" é recusado.
- **Conversar com o Jesus (desde a etapa 11, 21/10/2026):** com a chave de API criada no Console (item abaixo), abrir o Jesus, ir em Configurações, colar a chave em "Chave de API" e clicar em "Guardar" (ela vai para o cofre do Windows e não aparece mais). Voltar ao início e perguntar. Cada pergunta passa pelo teto do dia (US$ 1 por padrão, muda em Configurações). Nunca colar a chave no chat da sessão nem em arquivo.
- **Se o Jesus de produção não abrir:** desde 21/10/2026 ele recusa abrir com variáveis `NODE_*` fora de uma lista curta (por exemplo, `NODE_DEBUG` e `NODE_COMPILE_CACHE`), como já recusava `ELECTRON_*`. A recusa é silenciosa (o motivo vai para o stderr). Conferir no PowerShell com `Get-ChildItem Env: | Where-Object Name -like 'NODE_*'`.
- No fim do projeto, levar a `main-7zybuc` para a `main` (ele mesmo faz).
- Criar a conta no Console da Anthropic (platform.claude.com), cadastrar cartão internacional, pôr um limite de gasto e criar a chave de API (guardar num gerenciador de senhas; ela só entra no Jesus pelo cofre, na fase 1).

## Ambiente e armadilhas

- **Commits sempre na conta do dono** (`Mateus Fernando <mateusfss368@gmail.com>`), pedido dele. A imagem da nuvem vem com o git configurado como "Claude"; o gancho de início de sessão corrige isso.
  - Os 14 primeiros commits do PR #1 saíram como "Claude".
  - Corrigir o autor deles exige push forçado, que o sistema de segurança da sessão bloqueou. Fica para o dono decidir na hora de levar para a `main` (autorizar o push forçado ou deixar como está).

- Sessões na nuvem vêm com npm 10, que o projeto recusa: rodar `npm install -g npm@11.21.0` antes de `npm ci`.
- O proxy da nuvem bloqueia os sites do DeepSeek, DeepInfra e Fireworks (pesquisa só por buscador). O site de docs da Anthropic abre.
- O servidor da nuvem tem 4 CPUs: workflows com muitos agentes rodam só 2 por vez.
- Testes visuais do holograma: Chromium sem GPU roda a ~6 fps; os fps reais só no PC do dono.
- **Prisma:** a etiqueta `latest` do pacote `prisma` apontava para um candidato da versão 8 (`8.0.0-rc.22`); use sempre a 7.10.0 fixada nos três pacotes (`prisma`, `@prisma/client`, `@prisma/adapter-pg`). Rode o Prisma pelos scripts do `packages/db`: a CLI chamada direto baixa um binário nativo.
- **`npm audit` acusa 4 alertas altos**, todos da CLI do Prisma (`prisma` → `@prisma/config` → `deepmerge-ts`, e `mysql2`). A CLI é só ferramenta de desenvolvimento (o app instalado não a leva, decisão 0014), o projeto não usa MySQL e o `deepmerge-ts` só junta a configuração do próprio projeto. O "conserto" do `npm audit fix --force` rebaixaria o Prisma para a 6: não aplicar. Reavaliar quando sair uma 7.x que atualize essas dependências.
- **Workspace novo:** rode `npm install` antes de `npm install <pacote> -w <pasta>`. Sem isso o npm avisa "no workspace folder present" e não grava a dependência.
- **PostgreSQL de teste na nuvem:** `bash scripts/cloud-test-db.sh` (cluster em `/var/lib/postgresql/jesus-test`, porta 54329). Não use a pasta de rascunho da sessão para os dados: as permissões dela mudam e derrubam o servidor.
- **`apps/ui/AGENTS.md`:** o `next dev` escreve esse arquivo sozinho quando percebe um agente de IA (`next/dist/server/lib/generate-agent-files.js`). Ele está no git de propósito, para não reaparecer como mudança a cada sessão.
- **Matar o servidor do Next:** `pgrep -f "next start"` e `pkill -f` acham o próprio shell (o texto do comando contém o padrão) e derrubam a chamada com código 144. Liste com `ps -eo pid,args | grep -E "next-server|next start"` e mate pelos números.
- **Testar o `Host`:** o `fetch` do Node ignora o cabeçalho `Host`; use `curl -H Host:…`.
- **Matar o `node server.js` do standalone:** até `grep "[n]ode server.js"` acha o próprio shell quando o texto está na linha de comando (código 144). Use `ps -eo pid,args | awk '$2=="node" && $3=="server.js" {print $1}'`.
- **Build standalone do Next:** ele copia o `.env` do `apps/ui` para dentro do build. O `stage-ui.mjs` recusa a montagem nesse caso; apague o arquivo do build (ou do `apps/ui`) e monte de novo.
- **Electron na nuvem:** roda como root, então precisa de `--no-sandbox` (o harness dos testes põe sozinho); `xvfb-run -a` para ter um X. Avisos de `dbus` no stderr são normais.
- **`@electron/fuses` 1.8:** não exporta os estados; no binário, desligado é 48 (`"0"`) e ligado é 49 (`"1"`).
- **Testar como usuário comum na nuvem:** a conferência que abre o app pula quando roda como root. Dá para usar um usuário comum (`useradd -m tester`, `su tester -s /bin/bash -c '… xvfb-run -a …'`); a sandbox do Chromium sobe sem ajuste.
- **Playwright com o Electron:** use o harness de `apps/desktop/src/e2e/harness.ts` (CDP + inspetor do Node), não o `_electron.launch` (veja a etapa 3).
- **Teste de integração do desktop:** precisa do build montado (`JESUS_DESKTOP_BUILD=1 npm run build -w @jesus/ui && npm run stage:ui -w @jesus/desktop`); sem ele, falha de propósito (não é pulado). Ele roda o Next no próprio processo do teste: o `fetch` global e o `process.env` desse processo mudam.
- **Servidor estático para testar a exportação:** depois de um novo `next build`, a pasta `out` é recriada; um servidor que já estava servindo a pasta antiga devolve 404. Reinicie o servidor (e cuidado com `pkill -f`, que pode matar o próprio shell).
