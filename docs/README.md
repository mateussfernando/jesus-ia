# Documentação do Jesus

Assistente pessoal de IA para Windows, inspirado no JARVIS e na arquitetura do Claude Code.

> **Status (10/10/2026):** fase 0 (protótipo do holograma) concluída e aprovada. O projeto passou para React + Next.js + TypeScript, com Prisma e senha local com bcrypt ([decisões 0013 a 0015](decisoes/)). Detalhes na seção [8.8](08-holograma.md) e no [diário de bordo](progresso.md).

## Por onde começar

- **Dono do projeto:** [01-visao.md](01-visao.md), a seção 3.0 de [03-seguranca.md](03-seguranca.md) (as invariantes) e [10-roadmap.md](10-roadmap.md).
- **Agentes de IA (Claude Code etc.):** leia [`../CLAUDE.md`](../CLAUDE.md) e [03-seguranca.md](03-seguranca.md) antes de qualquer tarefa, e depois o documento da área que vai mexer. Regras marcadas como **INVARIANTE** são inegociáveis; nenhuma tarefa justifica enfraquecê-las sem uma decisão registrada em [decisoes/](decisoes/).

## Índice

| Parte | Arquivo | Conteúdo |
|---|---|---|
| 1 | [01-visao.md](01-visao.md) | o que é o Jesus, funcionalidades, fora de escopo, princípios, glossário |
| 2 | [02-arquitetura.md](02-arquitetura.md) | mapa Claude Code → Jesus, processos, loop do agente, ferramentas, hooks, contexto |
| 3 | [03-seguranca.md](03-seguranca.md) | **política de segurança**: invariantes, pesquisa, ameaças, Porteiro, proibições |
| 4 | [04-tecnologias.md](04-tecnologias.md) | requisitos, TypeScript, stack, hardware, estrutura do repositório |
| 5 | [05-dados-postgresql.md](05-dados-postgresql.md) | PostgreSQL local, segurança do banco, esquema, memória |
| 6 | [06-integracoes.md](06-integracoes.md) | OAuth (Google, GitHub…), MCP, exemplo completo da agenda |
| 7 | [07-voz.md](07-voz.md) | pipeline de voz, ativação, STT e TTS em português |
| 8 | [08-holograma.md](08-holograma.md) | gramática visual, estados, cores, implementação |
| 9 | [09-modelos.md](09-modelos.md) | provedores, papéis, custos, modelos locais |
| 10 | [10-roadmap.md](10-roadmap.md) | fases, uso dos créditos na nuvem, decisões |
| — | [prompts.md](prompts.md) | rascunhos do prompt do Jesus (Apêndice A) e do Porteiro (Apêndice B) |
| — | [referencias.md](referencias.md) | fontes (Apêndice D) |
| — | [decisoes/](decisoes/) | registro de decisões (ADR) |
| — | [progresso.md](progresso.md) | **diário de bordo**: onde paramos, o que está em andamento e o que falta (leia antes de qualquer tarefa) |
| — | [rascunhos/](rascunhos/) | especificações em rascunho, ainda não promovidas a documentação oficial |

## Convenções

- **DEVE** = obrigatório · **DEVERIA** = recomendado · **PODE** = opcional.
- **Numeração:** cada arquivo mantém a numeração original (Parte 3 → seções 3.x). Uma referência como "seção 3.4.6" está em [03-seguranca.md](03-seguranca.md).
- **Nomes:** os exemplos de ferramentas e tabelas estão em português para facilitar a leitura (ex.: `agenda.criar`). No código, os identificadores são em inglês (ex.: `calendar.create_event`); veja [decisoes/0007](decisoes/0007-padroes-iniciais.md).
- **Fontes:** afirmações baseadas em pesquisa trazem link; a lista completa está em [referencias.md](referencias.md). As versões de bibliotecas foram verificadas em outubro de 2026 e **devem ser conferidas de novo** na hora de instalar.
- **Mudou uma decisão?** Registre em [decisoes/](decisoes/) e atualize o documento afetado no mesmo PR.
