# Progresso (diário de bordo)

> **Leia isto antes de qualquer tarefa** e atualize ao terminar cada etapa (o que foi feito, o que falta, onde parou). Serve para continuar o trabalho em outra sessão sem perder contexto. O resumo fixo do projeto está no [`CLAUDE.md`](../CLAUDE.md); aqui fica o **andamento**.

**Última atualização:** 08/10/2026, ~14h40 UTC, sessão na nuvem (branch `main-7zybuc`).

## Onde estamos

- **Fase 0 (holograma): concluída e aprovada** pelo dono do projeto. Ele mediu 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada; em GPU integrada ainda não foi medido.
- **PR #1** (`main-7zybuc` → `main`): https://github.com/mateussfernando/jesus-ia/pull/1. CI verde até `ad93238`, sem conflitos; descrição atualizada. **Aguarda o merge do dono do projeto** (ele perguntou se precisa fazer: o Claude pode fazer pelo GitHub, mas só com autorização explícita). Contém: monorepo npm, `packages/hologram`, `apps/hologram-lab`, `packages/models`, `packages/core`, docs e as decisões 0008 a 0011.
- **Próxima fase do roadmap:** fase 1 (Electron abrindo janela, chat por texto, 1 provedor, ferramentas só de leitura, registro). Ver `docs/10-roadmap.md`.

## Decisões tomadas nesta etapa

| Nº | Decisão |
|---|---|
| [0008](decisoes/0008-holograma-como-pacote-e-laboratorio.md) | Holograma como pacote próprio + laboratório web; TypeScript 6.0 |
| [0009](decisoes/0009-npm-em-vez-de-pnpm.md) | npm workspaces em vez de pnpm (pedido do dono), com `.npmrc` endurecido após revisão adversarial |
| [0010](decisoes/0010-primeiro-modelo-deepseek-via-deepinfra.md) | DeepSeek na DeepInfra — **substituída** pela 0011 (saiu mais cara que o esperado) |
| [0011](decisoes/0011-primeiro-modelo-claude-haiku.md) | **Cérebro = Claude Haiku 5.5** (~US$ 2/mês no uso típico; privacidade; 5× mais caro acima de 100 mil tokens por pedido) |

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
  - [Login e conexão automáticos](rascunhos/algoritmo-login.md) (**só o rascunho**: a crítica caiu pelo limite de uso) → `packages/integrations/src/connect`

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

**Falta (nesta ordem):**
1. Contexto, parte 3: âncora no uso real e calibração (seção 7.2–7.4) e livro de gastos (seção 8.2).
2. Fazer a crítica do rascunho de **login** (segurança, qualidade e testabilidade), como foi feito com os outros três.
3. Implementar, um pacote por vez, com testes: memória → login → subagentes. Ligar cada um ao holograma e trocar os controles manuais correspondentes do laboratório por simulação automática.
4. Promover as quatro especificações a documentação oficial (seções em `docs/02`, `05`, `06`, `09`), com decisão registrada se mudar algo já decidido.

## Pendências do dono do projeto

- Fazer o merge do PR #1.
- Criar a conta no Console da Anthropic (platform.claude.com), cadastrar cartão internacional, pôr um limite de gasto e criar a chave de API (guardar num gerenciador de senhas; ela só entra no Jesus pelo cofre, na fase 1).

## Ambiente e armadilhas

- Sessões na nuvem vêm com npm 10, que o projeto recusa: rodar `npm install -g npm@11.21.0` antes de `npm ci`.
- O proxy da nuvem bloqueia os sites do DeepSeek, DeepInfra e Fireworks (pesquisa só por buscador). O site de docs da Anthropic abre.
- O servidor da nuvem tem 4 CPUs: workflows com muitos agentes rodam só 2 por vez.
- Testes visuais do holograma: Chromium sem GPU roda a ~6 fps; os fps reais só no PC do dono.
