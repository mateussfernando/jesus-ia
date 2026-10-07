# Parte 1 — Visão

> [Índice da documentação](README.md) · Parte 1 de 10 · as seções seguem a numeração 1.x

## 1.1 O que é o Jesus

O Jesus é um assistente pessoal de IA que roda **no seu próprio PC** (Windows), instalado por um `.exe`. Você fala com ele por **voz** ou texto, e ele:

- **programa** para você (lê, edita e cria código, roda testes, usa git);
- **opera o terminal** com uma política de segurança;
- **cuida das suas contas** conectadas por meios oficiais (Google Agenda, Gmail, Drive, GitHub e outras via OAuth);
- **pesquisa** na web e lê documentos;
- **lembra de você** (memória de longo prazo num PostgreSQL local);
- e mostra tudo isso num **holograma 3D prateado** que é, ao mesmo tempo, o "rosto" dele e um **painel de instrumentos**.

Em uma frase: **um "Claude Code pessoal" que funciona com qualquer modelo de IA, fala português, conhece você e tem um porteiro de segurança, com um holograma como rosto.**

### As cinco partes

| Parte | O que é | Analogia |
|---|---|---|
| **Cérebro** | Um modelo de IA, trocável (Claude, GPT, Gemini, modelos locais…) | O motor |
| **Mãos** | As ferramentas: arquivos, terminal, Google, GitHub, servidores MCP | A caixa de ferramentas |
| **Porteiro** | A camada de segurança, feita em código, **fora** da IA | O segurança da portaria |
| **Memória** | PostgreSQL local com conversas, fatos e preferências | O caderno |
| **Rosto** | Holograma 3D informativo + voz | O painel do carro |

**Ideia central:** a IA só **propõe** ações. Quem decide é o Porteiro (código, com regras suas) e quem executa é o Executor (um processo separado, que guarda os tokens). Mesmo que a IA seja enganada por um e-mail malicioso, ela não consegue causar estrago sozinha.

## 1.2 Por que "parecido com o Claude Code"

O Claude Code é um *agentic harness*: a camada em volta do modelo que fornece as ferramentas e gerencia o contexto que o modelo vê ([Anthropic — How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)). Essa arquitetura já é usada no dia a dia por muita gente, então o Jesus **copia as ideias que funcionam** e acrescenta o que é dele:

| O Jesus copia do Claude Code | O Jesus acrescenta |
|---|---|
| Loop agêntico (coletar contexto → agir → verificar) | Funciona com **qualquer modelo** (não só Claude) |
| Poucas ferramentas poderosas (ler, editar, buscar, terminal, web, subagentes) | **Voz** em português, com palavra de ativação |
| Regras de permissão `deny → ask → allow` e modos de permissão | **Holograma** que mostra o estado do sistema |
| Modo automático com classificador de risco | **Contas pessoais** (Agenda, Gmail, Drive, GitHub…) |
| Ganchos (*hooks*), habilidades (*skills*), subagentes | **Memória sobre você** em PostgreSQL |
| Arquivo de instruções (`CLAUDE.md` → `JESUS.md`) e memória automática | App de desktop instalável para **Windows** |
| Compactação de contexto, checkpoints, sessões | Política de segurança para **ações pessoais** (e-mail, convites, compras) |
| Sandbox para comandos; MCP para extensões | |

A comparação detalhada, conceito por conceito, está na seção [2.1](02-arquitetura.md).

### E o Claude Agent SDK?

A Anthropic oferece o **Claude Agent SDK**, que é literalmente "o Claude Code como biblioteca" (TypeScript e Python), com as mesmas ferramentas, hooks, subagentes, MCP, permissões e sessões ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)). Ele é ótimo, mas tem três limites para o Jesus:

1. Ele roda o binário do Claude Code e usa **modelos Claude**, e o Jesus precisa ser multi-modelo.
2. Produtos de terceiros devem usar **chave de API** (não o login do claude.ai).
3. As regras de marca proíbem chamar o produto de "Claude Code" ou imitar o visual dele (para uso pessoal isso pouco importa, mas é bom saber).

**Decisão:** o núcleo do Jesus é um *harness* próprio, construído sobre uma biblioteca multi-modelo ([Parte 4](04-tecnologias.md)). O Agent SDK **pode** entrar depois como um "motor de programação" opcional quando o cérebro escolhido for Claude.

## 1.3 Funcionalidades

### Primeira versão (MVP)

- Conversa por **texto** e **voz** (pt-BR), com interrupção.
- **Programação** em pastas que você liberar: ler, buscar, editar, criar arquivos, rodar testes, usar git.
- **Terminal** com política de segurança e execução contida (seção [3.6](03-seguranca.md)).
- **Google:** Agenda (ler e criar eventos), Gmail (ler, resumir, criar rascunhos; enviar só com confirmação), Contatos.
- **GitHub:** repositórios, issues e pull requests.
- **Pesquisa na web** e leitura de páginas (sempre como conteúdo não confiável).
- **Memória de longo prazo** sobre você (PostgreSQL + busca semântica).
- **Holograma** informativo e registro de tudo o que ele fez.
- **Multi-modelo**, com você colando as próprias chaves de API.

### Depois

- Subagentes trabalhando em paralelo; rotinas agendadas (ex.: resumo da manhã).
- Ler a tela (visão) quando você pedir.
- Google Drive, Microsoft (Outlook/OneDrive), Notion, Spotify, Todoist e outros via OAuth/MCP.
- Falar com o Jesus pelo celular (bot oficial do Telegram).
- Modo conversa em tempo real (fala-para-fala).

## 1.4 Fora de escopo

- **Mexer em dinheiro:** comprar, pagar, Pix, investir, cripto. Ele pode pesquisar e montar uma lista; quem paga é você.
- **Senhas e contas:** ele não digita senhas, não cria contas, não faz login por você. Login é sempre você, na página oficial.
- **WhatsApp pessoal:** não há API oficial para contas pessoais, e métodos não oficiais podem banir o número.
- **Controlar mouse e teclado do PC inteiro** no MVP (é poderoso, mas o risco é alto; fica para depois, com regras próprias).
- **Hospedar na nuvem ou ter vários usuários:** o Jesus é local e de uma pessoa só.

## 1.5 Princípios de produto

1. **Local primeiro.** Seus dados ficam no seu PC; só vai para a nuvem o que precisa ir (a conversa com o modelo de IA escolhido).
2. **Transparência.** Você sempre consegue ver o que ele está fazendo e por quê: no holograma, no registro e nos cartões de confirmação.
3. **Confiança se conquista.** Ele começa com pouca autonomia e ganha mais conforme você libera.
4. **Nada se mexe sem motivo.** O holograma só mostra atividade real.
5. **Voz é atalho, não autorização.**
6. **Qualquer modelo, mesma segurança.** Trocar de modelo nunca afrouxa as regras.

## 1.6 Nome e palavra de ativação

- **Cuidado com "Jesus" como palavra de ativação.** É uma palavra dita o tempo todo ("ai, Jesus!", músicas, TV, igreja). Vai ter muita ativação falsa, e uma TV dizendo "Jesus, apaga…" não pode virar comando. Solução: frase de duas palavras (**"Ei, Jesus"**) + **atalho de teclado** de segurar-para-falar + as regras de voz da seção [3.11](03-seguranca.md).
- **Sigla (bônus):** como o JARVIS ("Just A Rather Very Intelligent System"), o nome pode virar sigla: **J.E.S.U.S. = Juízo, Execução, Segurança, Unificação e Sabedoria**, onde "Juízo" é literalmente o Porteiro. Ajuda também se um dia você distribuir o app, já que algumas pessoas podem estranhar o nome sozinho.

## 1.7 Glossário

| Termo | Significado |
|---|---|
| **Agente** | IA que planeja passos e usa ferramentas para cumprir uma tarefa |
| **Harness** | O programa em volta do modelo: dá ferramentas, monta o contexto, aplica regras |
| **Ferramenta (tool)** | Função que o modelo pode pedir para executar (ex.: `agenda.criar`) |
| **Chamada de ferramenta** | O pedido do modelo para executar uma ferramenta com certos parâmetros |
| **Porteiro** | Camada de segurança que decide se uma chamada pode ser executada |
| **Executor** | Processo separado que executa as chamadas aprovadas e guarda os tokens |
| **Classificador** | Modelo de IA separado que avalia o risco de uma ação |
| **Conteúdo não confiável** | Tudo que vem de fora: e-mails, sites, documentos, issues, transcrições |
| **Injeção de prompt** | Texto malicioso escondido em conteúdo externo tentando dar ordens à IA |
| **Contaminação (taint)** | Marca de que a tarefa já leu conteúdo não confiável |
| **OAuth** | Padrão oficial para autorizar um app a acessar sua conta sem entregar a senha |
| **Escopo** | O "tamanho" da permissão OAuth (ex.: só ler a agenda) |
| **MCP** | *Model Context Protocol*: padrão aberto para conectar ferramentas a agentes de IA |
| **Contexto** | Tudo o que o modelo "vê" numa conversa (limitado em tokens) |
| **Compactação** | Resumir o contexto quando ele enche |
| **Embedding** | Vetor numérico que representa o significado de um texto (para busca semântica) |
| **Sandbox** | Ambiente isolado onde um comando roda sem acesso ao resto do PC |
| **Checkpoint** | Cópia de um arquivo antes de editar, para poder desfazer |
| **Subagente** | Agente auxiliar com contexto próprio, que devolve só um resumo |
| **Habilidade (skill)** | Pacote de instruções carregado só quando necessário |
