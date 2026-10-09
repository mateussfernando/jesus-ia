# Progresso (diário de bordo)

> **Leia isto antes de qualquer tarefa** e atualize ao terminar cada etapa (o que foi feito, o que falta, onde parou). Serve para continuar o trabalho em outra sessão sem perder contexto. O resumo fixo do projeto está no [`CLAUDE.md`](../CLAUDE.md); aqui fica o **andamento**.

**Última atualização:** 09/10/2026, sessão na nuvem (branch `main-7zybuc`).

## Onde estamos

- **Fase 0 (holograma): concluída e aprovada** pelo dono do projeto. Ele mediu 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada; em GPU integrada ainda não foi medido.
- **Branch de trabalho: `main-7zybuc`** (PR #1: https://github.com/mateussfernando/jesus-ia/pull/1, CI verde). **Decisão do dono:** todo o trabalho fica nessa branch até o projeto ficar pronto; ele mesmo leva para a `main` no fim. Sessões novas devem partir dela e fazer commit e push nela; não fazer merge.
- **Próxima fase do roadmap:** fase 1 (Electron abrindo janela, chat por texto, 1 provedor, ferramentas só de leitura, registro) e, logo depois, a nova **fase 1.5: conversa por voz, só perguntas e respostas** (decisão 0012, pedido do dono). Ver `docs/10-roadmap.md`.

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

**Falta (nesta ordem):**
1. Fazer a crítica do rascunho de **login** (segurança, qualidade e testabilidade), como foi feito com os outros três.
2. Implementar, um pacote por vez, com testes: memória → login → subagentes. Ligar cada um ao holograma e trocar os controles manuais correspondentes do laboratório por simulação automática.
3. Promover as quatro especificações a documentação oficial (seções em `docs/02`, `05`, `06`, `09`), com decisão registrada se mudar algo já decidido.

**Pedidos do dono que valem para as próximas fases:**
- Aba **"Cenários"** no app, com o laboratório do holograma, da fase 1 até a final (seção 8.8; na fase 10 ele decide se sai).
- Fase **1.5**: conversa por voz, só perguntas e respostas, antes do Porteiro (decisão 0012).
- Tela **"Permissões"**: tudo que ele liberou, com remoção a qualquer hora (seção 3.4.7).
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
