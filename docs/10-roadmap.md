# Parte 10 — Roadmap

> [Índice da documentação](README.md) · Parte 10 de 10 · as seções seguem a numeração 10.x

## 10.1 Fases

| Fase | Entrega | Pronto quando… |
|---|---|---|
| **0. Holograma** | protótipo web do holograma com dados falsos (estados, satélites, contexto, cores) | roda a 60 fps e você aprova a identidade visual |
| **1. Esqueleto** | monorepo, Electron abrindo janela, chat por texto, 1 provedor, ferramentas só de leitura (arquivos), registro | conversa e lê arquivos de uma pasta liberada; testes rodando no CI |
| **2. Porteiro** | normalização, regras `deny/ask/allow`, caminhos protegidos e críticos, cartões de confirmação assinados, auditoria encadeada | 100% dos testes de regras passando; nenhuma ação executa sem passar pelo Porteiro |
| **3. Mãos com contenção** | terminal no Windows com as compensações da seção [3.6](03-seguranca.md) (ambiente limpo, token restrito, Job Object), edição com checkpoint, git local; WSL2 opcional depois | roda os testes de um projeto real; cancelar mata a árvore de processos; o desfazer funciona |
| **4. Banco e memória** | PostgreSQL embutido, migrações, sessões, memória com busca híbrida | lembra fatos entre sessões; "esquecer" funciona |
| **5. Classificador e contaminação** | Camada 3 (dois estágios), sonda de injeção, leitor em quarentena, Regra dos Dois | na coleção de ataques: 0 ações proibidas executadas e metas da seção [3.17](03-seguranca.md) atingidas |
| **6. Voz** | segurar-para-falar, STT local, TTS, holograma sincronizado; depois "Ei, Jesus" | conversa por voz começando a responder em cerca de 2 s |
| **7. Contas** | Google (leitura → escrita com confirmação), GitHub App (*device flow*) | o cenário da agenda (seção [6.7](06-integracoes.md)) funciona inteiro, incluindo o ataque bloqueado |
| **8. Multi-modelo** | registro de modelos, papéis, custos, Ollama | trocar o cérebro sem mudar mais nada; anel de gasto funcionando |
| **9. Extensões** | MCP (com hash e aprovação), habilidades, subagentes, rotinas | 1 servidor MCP oficial funcionando; 1 rotina diária |
| **10. Polimento** | modo mini, instalador, atualização, backups | instalação limpa num PC novo |

**A ordem importa: o Porteiro vem antes de o Jesus ganhar acesso ao terminal e às contas.**

**Andamento (08/10/2026):** fase 0 **concluída** (`packages/hologram` + `apps/hologram-lab`, seção [8.8](08-holograma.md)). O dono do projeto aprovou a identidade visual e mediu 75 fps (o máximo da tela) num PC de 8 GB com placa de vídeo dedicada; em GPU integrada ainda não foi medido.

## 10.2 Usando os créditos do Claude Code na nuvem

- Uma fase (ou um pacote) por sessão, com o pedido bem descrito e o critério de "pronto quando".
- Comece no modo Planejar, aprove o plano e só então execute.
- Mantenha o `CLAUDE.md` da raiz curto, apontando para os documentos.
- Peça testes junto com o código, e peça para atualizar os documentos quando uma decisão mudar.
- Evite sessões do tipo "explore tudo": custam caro e enchem o contexto.
- Lembre: microfone e janelas se testam no seu PC; contenção de processos e DPAPI, no GitHub Actions (`windows-latest`) ou no seu PC; o `.exe` sai do GitHub Actions.

## 10.3 Decisões em aberto (para você)

**Decidido em 07/10/2026** (registros em `docs/decisoes/`):

- **TypeScript** como linguagem principal e **Electron** como app de desktop.
- Alvo de hardware: **8 a 16 GB de RAM, sem placa de vídeo dedicada** (seção [4.6](04-tecnologias.md)).
- **Comandos direto no Windows**, como o Claude Code, sem instalar nada externo; WSL2 como opção avançada (seção [3.6](03-seguranca.md)).
- **Identificadores em inglês** (código, banco, ferramentas); textos de interface e documentação em português.
- **Uso pessoal** por enquanto: cada usuário cria o próprio projeto no Google; sem assinatura de código.
- Nome **"Jesus"**, ativação por **"Ei, Jesus" + tecla** de segurar-para-falar.
- Primeiras contas: **Google e GitHub**.
- Conversas guardadas por **90 dias** (seção [5.7](05-dados-postgresql.md)).
- Voz local: **Parakeet** (STT) e **Piper** (TTS).

**Em aberto:**

1. Quais **provedores de IA** primeiro? De quais você já tem chave? (necessário para conversar com o Jesus no fim da fase 1)
2. **Distribuir** para outras pessoas um dia? Muda a verificação do Google, a assinatura do instalador e as licenças (o Piper é GPL-3.0). Pode esperar.
