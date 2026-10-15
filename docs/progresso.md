# Progresso (diário de bordo)

> **Leia isto antes de qualquer tarefa** e atualize ao terminar cada etapa (o que foi feito, o que falta, onde parou). Serve para continuar o trabalho em outra sessão sem perder contexto. O resumo fixo do projeto está no [`CLAUDE.md`](../CLAUDE.md); aqui fica o **andamento**.

**Última atualização:** 12/10/2026, sessão na nuvem (trabalho feito na `ccr-d2d5ac72-nmmks6` e levado para a `main-7zybuc` com o aval do dono; veja "Branch" abaixo).

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

**Falta (nesta ordem):**
1. **Fase 1, conforme o [plano da fase 1](rascunhos/plano-fase-1.md)** (14 etapas, montado em 13/10/2026 por pesquisa, planejador e crítico): Electron (`apps/desktop`) com o servidor do Next num utilityProcess, sem porta; empacotamento e `.exe` no `windows-latest`; registro; eventos do Windows; cofre da chave; Cérebro e saída para a API; chat com o Claude Haiku 5.5; Porteiro mínimo para leituras; ferramentas de leitura; tela do registro. **Feito:** etapa 0 (13/10/2026). **Próxima:** etapa 1 (`apps/desktop` com o núcleo puro).
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
- **Matar o servidor do Next:** `pgrep -f "next start"` e `pkill -f` acham o próprio shell (o texto do comando contém o padrão) e derrubam a chamada com código 144. Liste com `ps -eo pid,args | grep -E "next-server|next start"` e mate pelos números.
- **Testar o `Host`:** o `fetch` do Node ignora o cabeçalho `Host`; use `curl -H Host:…`.
- **Servidor estático para testar a exportação:** depois de um novo `next build`, a pasta `out` é recriada; um servidor que já estava servindo a pasta antiga devolve 404. Reinicie o servidor (e cuidado com `pkill -f`, que pode matar o próprio shell).
