# Progresso (diário de bordo)

> **Leia isto antes de qualquer tarefa** e atualize ao terminar cada etapa (o que foi feito, o que falta, onde parou). Serve para continuar o trabalho em outra sessão sem perder contexto. O resumo fixo do projeto está no [`CLAUDE.md`](../CLAUDE.md); aqui fica o **andamento**.

**Última atualização:** 08/10/2026, ~03h UTC, sessão na nuvem (branch `main-7zybuc`). A sessão parou a pedido do dono porque o uso do plano estava acabando.

## Onde estamos

- **Fase 0 (holograma): concluída e aprovada** pelo dono do projeto. Ele mediu 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada; em GPU integrada ainda não foi medido.
- **PR #1** (`main-7zybuc` → `main`): https://github.com/mateussfernando/jesus-ia/pull/1. CI verde, sem conflitos. **Aguarda o merge do dono do projeto.** Contém: monorepo npm, `packages/hologram`, `apps/hologram-lab`, docs e as decisões 0008 a 0011.
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

**Falta (nesta ordem):**
1. Fazer a crítica do rascunho de **login** (segurança, qualidade e testabilidade), como foi feito com os outros três. Depois, promover as quatro especificações a documentação oficial (seções em `docs/02`, `05`, `06`, `09`), com decisão registrada se mudar algo já decidido.
2. Ajustar o rascunho de contexto ao modelo escolhido: o Claude Haiku 5.5 tem janela de 1 milhão, mas o preço sobe 5× acima de 100 mil tokens por pedido; o limite automático mira abaixo desse degrau. O rascunho foi escrito pensando no DeepSeek.
3. Implementar a lógica pura com testes (Vitest), um pacote por vez: `packages/models` → contexto → memória → login → subagentes.
4. Ligar ao holograma: o snapshot passa a ser montado pelos algoritmos; no laboratório, trocar os controles manuais de limite, subagentes, memória e login por simulação automática (ex.: escolher o modelo e o limite muda sozinho).

## Pendências do dono do projeto

- Fazer o merge do PR #1.
- Criar a conta no Console da Anthropic (platform.claude.com), cadastrar cartão internacional, pôr um limite de gasto e criar a chave de API (guardar num gerenciador de senhas; ela só entra no Jesus pelo cofre, na fase 1).

## Ambiente e armadilhas

- Sessões na nuvem vêm com npm 10, que o projeto recusa: rodar `npm install -g npm@11.21.0` antes de `npm ci`.
- O proxy da nuvem bloqueia os sites do DeepSeek, DeepInfra e Fireworks (pesquisa só por buscador). O site de docs da Anthropic abre.
- O servidor da nuvem tem 4 CPUs: workflows com muitos agentes rodam só 2 por vez.
- Testes visuais do holograma: Chromium sem GPU roda a ~6 fps; os fps reais só no PC do dono.
