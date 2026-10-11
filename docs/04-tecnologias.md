# Parte 4 — Tecnologias: requisitos, linguagem e bibliotecas

> [Índice da documentação](README.md) · Parte 4 de 10 · as seções seguem a numeração 4.x

## 4.1 Requisitos

### Funcionais

| ID | Requisito |
|---|---|
| RF-01 | Conversa por texto e voz em pt-BR, com interrupção |
| RF-02 | Funcionar com chaves de vários provedores de IA e com modelos locais |
| RF-03 | Ler, buscar, editar e criar arquivos em pastas liberadas |
| RF-04 | Executar comandos de terminal com política de segurança e isolamento |
| RF-05 | Conectar Google, GitHub e outros serviços por OAuth oficial |
| RF-06 | Memória de longo prazo em PostgreSQL local, com busca semântica |
| RF-07 | Porteiro com regras, classificador, confirmações e registro |
| RF-08 | Holograma 3D informativo, modo mini e modo central de comando |
| RF-09 | Instalação por `.exe` no Windows, com atualização |
| RF-10 | Servidores MCP locais e remotos |
| RF-11 | Subagentes, habilidades e ganchos |
| RF-12 | Rotinas agendadas |

### Não funcionais

| ID | Requisito |
|---|---|
| RNF-01 | Segurança conforme a [Parte 3](03-seguranca.md) (invariantes) |
| RNF-02 | Local primeiro: dados no PC, sem servidor próprio na nuvem |
| RNF-03 | Latência de voz: começar a responder em cerca de 1–2,5 s depois que você para de falar |
| RNF-04 | Holograma a 60 fps em GPU integrada comum; pouco uso de CPU em repouso |
| RNF-05 | Funcionar no Windows 11 Home |
| RNF-06 | Funcionar offline com modelos locais (com menos capacidade) |
| RNF-07 | Lógica testável em Linux (as sessões do Claude Code na nuvem rodam em Linux) |
| RNF-08 | Uma pessoa só consegue manter (pouca complexidade operacional) |

## 4.2 Python ou TypeScript?

| Critério | TypeScript | Python |
|---|---|---|
| Interface e holograma | nativo (Three.js, React) | precisa de JS/TS do mesmo jeito |
| App desktop `.exe` | Electron: maduro no Windows, com atualização | PyInstaller/Nuitka + pywebview; empacotar dependências de ML é trabalhoso |
| Agente multi-modelo | Vercel AI SDK | Pydantic AI, LiteLLM (empate) |
| MCP | SDK de referência | SDK oficial também (leve vantagem do TS) |
| PostgreSQL | Prisma (ou Drizzle/Kysely) + `pg` | SQLAlchemy + psycopg (empate) |
| Google e GitHub | `googleapis`, Octokit (oficiais) | clientes oficiais também (empate) |
| Voz local | sherpa-onnx (Node) cobre ativação, VAD, STT e TTS | melhor ecossistema (faster-whisper, openWakeWord) |
| IA/ML pesado | fraco | forte |
| Uma linguagem só | sim | não (a interface continua em JS) |

**Recomendação: TypeScript em tudo**, com uma porta aberta para um "trabalhador de voz" em Python se as bibliotecas de voz em Node não atenderem. Motivos:

1. A interface e o holograma obrigam JS/TS de qualquer forma.
2. O Electron empacota e atualiza bem no Windows.
3. AI SDK, SDK do MCP, `googleapis` e Octokit são de primeira linha em TypeScript.
4. Uma linguagem só = menos complexidade para você e para os agentes de IA que vão programar.
5. O ponto fraco (voz local) é coberto pelo sherpa-onnx, que roda em Node o Silero VAD, o Whisper, o Parakeet e vozes Piper/Kokoro.

## 4.3 Stack recomendada

| Camada | Escolha | Por quê | Alternativas |
|---|---|---|---|
| Linguagem | TypeScript (modo `strict`) | uma linguagem para tudo | Python (seção 4.5) |
| Runtime | Node.js LTS (24 hoje; o 26 vira LTS em 28/10/2026) | suporte longo | — |
| App desktop | Electron (versão estável atual) + electron-builder (instalador NSIS `.exe`) | maduro no Windows; janelas transparentes; `utilityProcess`; `safeStorage` | Tauri 2 (mais leve, mas o núcleo é em Rust) |
| Build e UI | **Next.js 16 (App Router) + React**, com servidor: páginas, Server Actions e rotas como back-end da interface, dentro do Electron e sem porta aberta ([decisões 0013](decisoes/0013-interface-em-nextjs-dentro-do-electron.md) e [0016](decisoes/0016-nextjs-com-servidor-dentro-do-electron.md)) | pedido do dono: front e back-end num lugar só; CSP com nonce | exportação estática + IPC (0013); Vite + React (fase 0) |
| Holograma | Three.js + React Three Fiber + pós-processamento (bloom) | padrão para WebGL | Babylon.js |
| Estado da UI | Zustand | simples | Redux |
| Núcleo do agente | Vercel AI SDK (`ai`): `ToolLoopAgent` + `toolApproval` | multi-provedor; aprovação de ferramentas nativa; aprovações assinadas | Mastra; loop próprio |
| Provedores | `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/groq`, `@ai-sdk/deepseek`, `@ai-sdk/xai`, `@ai-sdk/openai-compatible` (OpenRouter, LM Studio, Ollama) | cobre quase tudo | LiteLLM (Python) |
| Validação | Zod | esquemas das ferramentas | Valibot |
| MCP | `@modelcontextprotocol/sdk` (v1 estável; a v2 está em beta) | SDK oficial de referência | — |
| Banco | PostgreSQL 18 + pgvector 0.8.x | ver [Parte 5](05-dados-postgresql.md) | PostgreSQL 19 quando sair a versão final |
| Acesso ao banco | **Prisma 7** (cliente sem motor nativo, adaptador `@prisma/adapter-pg` sobre o `pg`) + migrações em SQL aplicadas por um migrador próprio ([decisão 0014](decisoes/0014-prisma-como-orm.md)) | pedido do dono; tipado; pgvector e o resto em SQL cru nas migrações | Drizzle; Kysely |
| Embeddings | locais via Ollama (`bge-m3` ou `qwen3-embedding`) | privacidade; multilíngue | API do provedor |
| Voz local | `sherpa-onnx-node` (VAD Silero, STT Parakeet v3 ou Whisper, TTS Piper ou Kokoro) | tudo em Node, offline | Python: faster-whisper + openWakeWord |
| Palavra de ativação | Picovoice Porcupine (`@picovoice/porcupine-node`, aceita português) | chave gratuita para uso pessoal | detecção via STT contínuo |
| Voz em nuvem (opcional) | ElevenLabs, OpenAI ou Azure (TTS); Groq, OpenAI ou Deepgram (STT) | qualidade e latência | — |
| Google | `googleapis` + `google-auth-library` | oficiais | — |
| GitHub | Octokit (`@octokit/rest`, `@octokit/auth-oauth-device`, `@octokit/auth-app`) | oficiais | — |
| Microsoft | `@azure/msal-node` | oficial | — |
| OAuth genérico | `openid-client` (PKCE, retorno local) | padrão | — |
| Segredos | `safeStorage` do Electron (DPAPI) | nativo | Gerenciador de Credenciais via módulo nativo (o antigo `keytar` foi arquivado) |
| Senha local e cifragem | **bcrypt** (`bcryptjs`, JavaScript puro, custo 12) para a senha do Jesus e o código de recuperação; **AES-256-GCM** (`node:crypto`) para dados que precisam ser lidos de volta ([decisão 0015](decisoes/0015-senha-local-com-bcrypt-e-dados-cifrados.md)) | o bcrypt é hash (sem volta): serve para conferir senha, nunca para cifrar dados | Argon2id (módulo nativo) |
| Parser de comandos | `tree-sitter` + gramática bash; parser de AST do PowerShell | normalização do Porteiro | — |
| Execução contida | processo do Windows com token restrito + Job Object (APIs nativas, via módulo nativo pequeno) | nada externo para instalar | upgrade: AppContainer; opcional: WSL2 |
| Logs | pino (aplicação) + tabela de auditoria no PostgreSQL | rápido | — |
| Testes | Vitest (unidade), Playwright (ponta a ponta no Electron), promptfoo (avaliações e red team de LLM) | — | — |
| Qualidade | ESLint + typescript-eslint, Prettier (ou Biome) | — | — |
| Monorepo | npm workspaces (npm 11.16+) | pacotes separados por responsabilidade; vem com o Node, nada a mais para instalar ([decisão 0009](decisoes/0009-npm-em-vez-de-pnpm.md)) | pnpm workspaces (isola melhor as dependências) |
| CI | GitHub Actions (testes em Linux; build do `.exe` em `windows-latest`) | gera o `.exe` sem depender do seu PC | — |

## 4.4 Detalhes por camada

### App desktop (Electron)

- **Janelas:**
  1. central de comando (maximizada ou tela cheia);
  2. modo mini: `transparent: true`, `frame: false`, `alwaysOnTop: true` e `setIgnoreMouseEvents(true, { forward: true })`, para o clique "atravessar" o holograma;
  3. ícone na bandeja do sistema.
- **Atalhos globais** (`globalShortcut`): segurar-para-falar e emergência.
- **Processos** (`utilityProcess`): cérebro, Porteiro/Executor e voz, conversando por `MessagePort`.
- **PostgreSQL** como processo filho gerenciado pelo processo principal (sobe e desce junto com o app).
- **Empacotamento:** electron-builder (NSIS). Binários (PostgreSQL, modelos de voz) ficam fora do `asar` (`extraResources`/`asarUnpack`).
- **Atualização:** electron-updater (GitHub Releases privado ou pasta local). Assinatura de código é opcional para uso pessoal; sem ela, o SmartScreen mostra um aviso.
- **Interface (decisões 0013 e 0016):** a janela carrega `https://jesus.invalid/`, um endereço que não existe na internet. O Electron intercepta esses pedidos só na sessão da janela do Jesus (`protocol.handle`), recusa qualquer outro endereço e entrega cada pedido ao servidor do Next carregado no próprio app (`next({ dir }).getRequestHandler()` com um adaptador em memória): nenhuma porta é aberta. Páginas, Server Actions e rotas do `apps/ui` são o back-end da interface; o Cérebro, o Porteiro + Executor e a voz continuam em `utilityProcess` próprios, falando com o Next por IPC. Rodar o Next no processo principal ou num `utilityProcess` só dele é decidido na fase 1, medindo.
- **Senha local (decisão 0015):** o processo principal guarda o estado de bloqueio (`@jesus/auth`), confere a senha (hash bcrypt na tabela `app_credentials`) e decide o que a janela mostra; a interface só exibe a tela de entrada.

### Núcleo do agente (AI SDK) e o encaixe do Porteiro

Na documentação atual do AI SDK, o `ToolLoopAgent` aceita uma regra `toolApproval` que devolve, para cada chamada, `approved`, `denied`, `user-approval` ou `not-applicable`, e as aprovações podem ser assinadas com HMAC ([AI SDK — Tool approvals](https://ai-sdk.dev/docs/agents/tool-approvals)). É exatamente o encaixe do Porteiro:

```ts
import { ToolLoopAgent } from 'ai';

const agente = new ToolLoopAgent({
  model: cerebro,                    // vem do registro de modelos (Parte 9)
  tools: ferramentasDoJesus,         // stubs que pedem a execução ao Executor por IPC
  toolApproval: async ({ toolCall, messages }) => {
    const d = await porteiro.avaliar(toolCall, contextoDaTarefa(messages));
    if (d.decisao === 'permitir') return 'approved';
    if (d.decisao === 'bloquear') return 'denied';
    return 'user-approval';          // a interface mostra o cartão de confirmação
  },
  experimental_toolApprovalSecret: segredoHmac, // aprovações assinadas
});
```

- Na versão 6 do AI SDK, o recurso equivalente se chamava `needsApproval`. Confira a API da versão instalada.
- O Executor **revalida** tudo: ele não confia que o cérebro chamou o Porteiro.

### Alternativa ao harness próprio: OpenCode

O OpenCode é o projeto aberto mais parecido com o Claude Code ([opencode.ai](https://opencode.ai/)): licença MIT, TypeScript, mais de 75 provedores via Models.dev, arquitetura cliente-servidor com API, agentes Build e Plan e permissões `allow/ask/deny`. Usos possíveis no Jesus:

- como **referência** de arquitetura;
- como **motor de programação** acionado por API para tarefas de código, com o Porteiro respondendo aos pedidos de permissão dele.

Atenção: as permissões do OpenCode são uma camada de política, não uma sandbox (comandos como `cat` ou `base64` contornam restrições de leitura). A execução continuaria dentro da sandbox do Jesus.

**Decisão:** começar com harness próprio e avaliar o OpenCode como motor de código numa fase posterior.

## 4.5 Alternativa 100% Python

| Camada | Escolha |
|---|---|
| App | pywebview (janela WebView2) ou Tauri com processo auxiliar em Python |
| Agente | Pydantic AI (v1 estável; aprovação humana via *deferred tools*) ou LiteLLM + loop próprio |
| MCP | SDK oficial em Python |
| Banco | SQLAlchemy 2 + psycopg 3 + pgvector-python + Alembic |
| Voz | faster-whisper, openWakeWord ou Porcupine, silero-vad, Piper ou Kokoro |
| Empacotar | PyInstaller ou Nuitka |

- **Prós:** melhor ecossistema de voz e ML.
- **Contras:** a interface e o holograma continuam em JS; empacotar Python com dependências de ML no Windows dá trabalho (tamanho, falsos positivos de antivírus); na prática são duas linguagens.
- **Atenção extra à cadeia de suprimentos** (caso LiteLLM, março de 2026): fixar versões com hash (lockfile do `uv` ou `pip install --require-hashes`).

## 4.6 Requisitos de hardware

**Decisão (07/10/2026): o Jesus DEVE funcionar em PCs com 8 a 16 GB de RAM e sem placa de vídeo dedicada (só GPU integrada).**

| Item | Alvo |
|---|---|
| CPU | 4 núcleos ou mais |
| RAM | 8 GB (mínimo) a 16 GB |
| Placa de vídeo | integrada (Intel/AMD); nada depende de GPU dedicada |
| Disco | ~10 GB livres (app, PostgreSQL, modelos de voz) |
| Sistema | Windows 11 (o Home serve); virtualização na BIOS só é necessária para o modo avançado com WSL2 |

**Consequências do alvo:**

- **Cérebro e Porteiro na nuvem** (via API). LLM local (Ollama) fica opcional, só para quem tiver máquina mais forte; não é requisito.
- **STT local com Parakeet v3** (int8, ~0,7 GB): roda mais rápido que a fala em CPU (seção [7.4](07-voz.md)). Whisper turbo em CPU é lento demais; vira opção só com nuvem.
- **TTS local com Piper** (leve em CPU). Kokoro como opção.
- **Embeddings:** modelo pequeno local (ex.: `qwen3-embedding` 0.6B, ou similar) ou API do provedor. Nada de modelos grandes.
- **Leitor em quarentena e sonda de injeção:** modelos baratos na nuvem.
- **Orçamento de memória (8 GB), aproximado:** Windows + navegador ~4 GB; Electron + holograma ~400–600 MB; PostgreSQL ~100–200 MB; voz (Parakeet + Piper) ~1 GB; comandos no modo padrão não têm custo fixo (o WSL2, se ligado no modo avançado, fica limitado a ~1–1,5 GB e só liga quando houver comando).
- **Holograma:** 3–5 mil partículas e bloom em meia resolução por padrão; modo "leve" automático em GPU integrada fraca ou na bateria.
- **Modo avançado com WSL2 (opcional):** em 8 GB, limitar a memória do WSL2 (arquivo `.wslconfig`, ex.: `memory=1536MB`) e desligá-la quando ociosa. Docker Desktop fica de fora por padrão (pesado demais para 8 GB).

## 4.7 Estrutura do repositório (proposta)

```text
jesus-ia/
├─ CLAUDE.md                 # contexto para o Claude Code
├─ docs/                     # documentação do projeto
├─ apps/
│  ├─ ui/                    # interface e back-end da interface em Next.js: Cenários, tela de entrada… (existe)
│  └─ desktop/               # Electron: main, preload, janelas, protocolo app:// (carrega o apps/ui)
├─ packages/
│  ├─ hologram/              # holograma: componente React Three Fiber + lógica visual pura (existe)
│  ├─ core/                  # loop do agente, contexto, compactação, subagentes
│  ├─ gate/                  # Porteiro: normalização, regras, classificador, políticas
│  ├─ executor/              # execução de ferramentas, cofre, sandbox, checkpoints
│  ├─ tools/                 # definições das ferramentas (arquivos, terminal, google, github…)
│  ├─ db/                    # Prisma: esquema, migrações SQL, migrador, repositórios (existe)
│  ├─ memory/                # memória de longo prazo, busca híbrida
│  ├─ voice/                 # ativação, VAD, STT, TTS
│  ├─ models/                # registro de modelos e provedores, custos (existe)
│  ├─ crypto/                # bcrypt (senhas) e AES-256-GCM (dados) (existe)
│  ├─ auth/                  # senha local do Jesus: regras, tentativas, bloqueio (existe)
│  ├─ integrations/          # OAuth (Google, GitHub, Microsoft), MCP
│  └─ shared/                # tipos, utilitários, mascaramento de segredos
├─ security/
│  ├─ policies/              # regras de fábrica (deny/ask/allow)
│  └─ attack-corpus/         # coleção de ataques para testes
└─ .github/workflows/        # CI: testes (Linux) + build do .exe (Windows)
```

## 4.8 Desenvolvendo com o Claude Code na nuvem

- As sessões na nuvem rodam numa **VM Linux isolada**. Dá para escrever e testar o núcleo, o Porteiro, o banco (PostgreSQL na VM ou em Docker), as ferramentas e a interface web. **Não** dá para testar microfone, janela do Windows, DPAPI, a contenção de processos do Windows (token restrito, Job Object), WSL2 nem o `.exe`.
- Por isso:
  1. mantenha a lógica em pacotes testáveis em Linux;
  2. gere o `.exe` e rode os testes específicos do Windows no GitHub Actions (`windows-latest`);
  3. teste voz e janelas no seu PC.
- O plano de uso dos créditos está na seção [10.2](10-roadmap.md).
- Repositório **privado** e **nenhum segredo** nele (`.gitignore` com `.env*`, chaves e arquivos de banco).

## 4.9 Versões de referência

Verificadas em 07/10/2026. Confira de novo na hora de instalar.

| Item | Situação |
|---|---|
| Node.js | 24 LTS (fase ativa até 20/10/2026); o 26 vira LTS em 28/10/2026 |
| npm | 12.2 é a `latest` (30/09/2026; exige Node ^22.22.2, ^24.15 ou 26+); a linha 11 está na 11.21. O projeto aceita 11.16+ ou 12: `min-release-age` existe desde a 11.10 e `strict-allow-scripts` desde a 11.16. O Node 24 traz o npm 11.16+ a partir do 24.18 (o 24.21 traz o 11.19); o Node 22 ainda traz o npm 10, que ignora essas opções sem aviso |
| TypeScript | 6.0 no projeto. A 7.0 (compilador nativo) já saiu, mas o typescript-eslint ainda aceita só `< 6.1` ([decisão 0008](decisoes/0008-holograma-como-pacote-e-laboratorio.md)) |
| Front-end | Next.js 16.4 (Turbopack), React 19.3, Three.js 0.186, React Three Fiber 9, `@react-three/postprocessing` 3, Zustand 5, Vitest 5. A fase 0 usou o Vite 8, trocado pelo Next.js na [decisão 0013](decisoes/0013-interface-em-nextjs-dentro-do-electron.md) |
| Prisma | 7.10 (cliente, CLI e `@prisma/adapter-pg` fixados na mesma versão). A etiqueta `latest` do pacote `prisma` apontava, em 10/10/2026, para um candidato da versão 8: não usar |
| bcrypt | `bcryptjs` 3.0.3 (JavaScript puro, sem script de instalação) |
| Electron | linha 44.x estável (setembro de 2026) |
| Vercel AI SDK | v7 (lançada em junho de 2026, segundo fontes de terceiros); a v6 (dezembro de 2025) introduziu a aprovação de ferramentas |
| SDK TypeScript do MCP | v1 estável; v2 em beta (pacotes separados `@modelcontextprotocol/client` e `/server`) |
| PostgreSQL | 18 estável; 19 em beta (beta 4 em 24/09/2026; versão final esperada para outubro) |
| pgvector | 0.8.5 (julho de 2026), compatível com PostgreSQL 13 a 18 |
| PGlite | 0.4 (março de 2026), ainda alfa |
| sherpa-onnx | 1.12/1.13 no npm |
| Piper | o projeto migrou para `OHF-Voice/piper1-gpl` (licença GPL-3.0) |
| Pydantic AI | v1 estável; v2 em beta |
