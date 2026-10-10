# Progresso (diário de bordo)

> **Leia isto antes de qualquer tarefa** e atualize ao terminar cada etapa (o que foi feito, o que falta, onde parou). Serve para continuar o trabalho em outra sessão sem perder contexto. O resumo fixo do projeto está no [`CLAUDE.md`](../CLAUDE.md); aqui fica o **andamento**.

**Última atualização:** 10/10/2026, sessão na nuvem (branch `ccr-d2d5ac72-nmmks6`, criada a partir da `main-7zybuc` no commit `d940e18`; veja "Branch" abaixo).

## Onde estamos

- **Fase 0 (holograma): concluída e aprovada** pelo dono do projeto. Ele mediu 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada; em GPU integrada ainda não foi medido.
- **Branch de trabalho: `main-7zybuc`** (PR #1: https://github.com/mateussfernando/jesus-ia/pull/1, CI verde). **Decisão do dono:** todo o trabalho fica nessa branch até o projeto ficar pronto; ele mesmo leva para a `main` no fim. Sessões novas devem partir dela e fazer commit e push nela; não fazer merge.
  - **Branch desta sessão (10/10/2026):** a sessão na nuvem só podia enviar para a `ccr-d2d5ac72-nmmks6`, que saiu da `main-7zybuc` no `d940e18`. Os commits desta sessão estão lá, numa linha reta sobre a `main-7zybuc` (dá para avançar a `main-7zybuc` sem merge). **Próxima sessão:** confira se o dono já levou esses commits para a `main-7zybuc`; se não, pergunte antes de enviar para lá.
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

- `packages/crypto` (29 testes): `hashPassword`/`verifyPassword` com `bcryptjs` (custo 12, NFC, recusa acima de 72 bytes em vez de cortar e recusa a senha certa seguida de qualquer coisa), códigos de recuperação de 100 bits (base32 de Crockford) e `sealField`/`openField` (AES-256-GCM, dado autenticado com tabela, coluna e linha; id de chave para trocar a chave).
- `packages/auth` (31 testes): regras da senha (`checkNewPassword`), espera progressiva (5 livres, depois 30 s dobrando até 15 min), máquina de bloqueio (`lockTransition`: inatividade, bloqueio do Windows, suspensão; cancela cartões e fluxos de conexão) e o serviço (`createAuthService`: criar, desbloquear, trocar, recuperar), com repositório em memória para testes.
- `packages/db` (14 testes, 6 contra PostgreSQL de verdade): Prisma 7.10, tabela `app_credentials` com restrições (uma linha, só hashes bcrypt) e privilégios (`jesus_app` sem acesso, `jesus_config` sem `DELETE`), migrador próprio com soma de verificação, repositório com contagem atômica. `prisma generate` sem baixar binário.
- `apps/ui` (39 testes): o laboratório saiu do Vite para o Next.js 16 (`/cenarios/`), mais início (`/`) e tela de entrada (`/entrar/`, demonstração em memória no navegador). CSP rígida com hashes dos scripts inline; Zod sem JIT; telemetria do Next desligada. Conferido no Chromium: sem violação de CSP; criar a senha leva ~0,9 s; 5 erros pedem 30 s; a recuperação respeita a mesma espera.
- CI: PostgreSQL com pgvector como serviço (testes do banco) e artefato `interface` no lugar de `hologram-lab`.
- 376 testes no projeto; lint, tipos e build limpos.

**Falta (nesta ordem):**
1. **Fase 1, Electron (`apps/desktop`):** processo principal com as regras da seção 3.12, protocolo `app://` servindo `apps/ui/out` com a CSP no cabeçalho (os hashes já ficam no `<meta>` de cada página), preload com a ponte mínima (`window.jesus.auth`, tipo `AuthBridge` em `apps/ui/src/auth/bridge.ts`), máquina de bloqueio ligada a `powerMonitor` (bloqueio do Windows, suspensão) e ao tempo sem uso, e build do `.exe` no CI `windows-latest`. **Escolha pendente:** a senha local precisa de banco já na fase 1, mas o PostgreSQL embutido é da fase 4. Recomendação: na fase 1, um `CredentialRepo` em arquivo na pasta do app (a porta já existe), trocado pelo `@jesus/db` na fase 4; a alternativa é adiantar o PostgreSQL embutido.
2. Fase 1, resto: chat por texto com o Claude Haiku 5.5 (chave pelo cofre), ferramentas só de leitura, registro.
3. Implementar, um pacote por vez, com testes: memória (com `maskSecrets`/`detectSensitive`/`canonicalJson` em `packages/shared`) → login automático de contas → subagentes. Ligar cada um ao holograma e trocar os controles manuais correspondentes do laboratório por simulação automática.
4. Promover as quatro especificações a documentação oficial (seções em `docs/02`, `05`, `06`, `09`), com decisão registrada se mudar algo já decidido.

**Pedidos do dono que valem para as próximas fases:**
- Aba **"Cenários"** no app, com o laboratório do holograma, da fase 1 até a final (seção 8.8; na fase 10 ele decide se sai).
- Fase **1.5**: conversa por voz, só perguntas e respostas, antes do Porteiro (decisão 0012).
- Tela **"Permissões"**: tudo que ele liberou, com remoção a qualquer hora (seção 3.4.7). Inclui as capacidades de contas conectadas (rascunho de login, seção 4.2).
- **Stack:** React + Next.js + TypeScript, Prisma, bcrypt na senha local (decisões 0013 a 0015).
- Recomendar o ultracode só quando valer (regra no `CLAUDE.md`); preferir sessão nova por etapa.

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
- **Workspace novo:** rode `npm install` antes de `npm install <pacote> -w <pasta>`. Sem isso o npm avisa "no workspace folder present" e não grava a dependência.
- **PostgreSQL de teste na nuvem:** `bash scripts/cloud-test-db.sh` (cluster em `/var/lib/postgresql/jesus-test`, porta 54329). Não use a pasta de rascunho da sessão para os dados: as permissões dela mudam e derrubam o servidor.
- **Servidor estático para testar a exportação:** depois de um novo `next build`, a pasta `out` é recriada; um servidor que já estava servindo a pasta antiga devolve 404. Reinicie o servidor (e cuidado com `pkill -f`, que pode matar o próprio shell).
