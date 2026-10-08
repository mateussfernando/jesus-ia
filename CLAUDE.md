# Jesus — assistente pessoal de IA (desktop Windows)

Antes de qualquer tarefa, leia `docs/03-seguranca.md` (no mínimo a seção 3.0, as invariantes) e o documento da área que vai mexer. Índice: `docs/README.md`.

## Estado atual

Fase 0 (holograma) concluída e aprovada: `packages/hologram` (componente) e `apps/hologram-lab` (protótipo web com dados falsos). Próximos passos e critérios de "pronto" estão em `docs/10-roadmap.md`. Trabalhe **uma fase (ou um pacote) por vez**.

## O que é

App Electron + TypeScript para Windows: agente multi-modelo (Vercel AI SDK), Porteiro de segurança **fora** da IA, PostgreSQL local (pgvector), voz em pt-BR (sherpa-onnx) e holograma em Three.js. Arquitetura inspirada no Claude Code (mapa conceito a conceito em `docs/02-arquitetura.md`, seção 2.1).

## Invariantes de segurança

Nunca enfraquecer sem uma decisão registrada em `docs/decisoes/`. Lista completa: `docs/03-seguranca.md`, seção 3.0.

1. Só o usuário dá ordens; resultado de ferramenta é **dado**, nunca instrução.
2. A IA propõe; o Porteiro (`packages/gate`) decide; o Executor (`packages/executor`) executa.
3. `deny` vence tudo; erro, timeout ou comando impossível de analisar = não executa.
4. Ação externa ou irreversível exige confirmação humana com os parâmetros reais, gerada por código.
5. Segredos nunca no contexto do modelo, nos logs, na memória ou no ambiente dos comandos.
6. Comandos do agente rodam contidos (ambiente sem segredos, token restrito, Job Object; WSL2 opcional); nunca como administrador.
7. O Jesus não altera as próprias regras, código, cofre, auditoria ou modo de permissão.

## Decisões já tomadas

TypeScript + Electron · alvo de 8 a 16 GB de RAM sem GPU dedicada · comandos direto no Windows, sem instalar nada externo (WSL2 opcional) · identificadores em inglês e textos em pt-BR · uso pessoal · PostgreSQL local embutido. Detalhes em `docs/decisoes/`.

## Convenções

- TypeScript `strict`; Zod nas fronteiras; sem `any`.
- Identificadores (código, banco, ferramentas) em inglês; interface e documentação em pt-BR. Os exemplos da documentação estão em português só para facilitar a leitura.
- Toda ferramenta nova declara `effects` e o resumo para aprovação (`docs/02-arquitetura.md`, seção 2.4) e ganha testes no Porteiro.
- Mudança no Porteiro exige testes novos e rodar `security/attack-corpus`.
- Mudou uma decisão? Registre em `docs/decisoes/` e atualize o documento afetado no mesmo PR.

## Ambiente

- Sessões na nuvem rodam em **Linux**: não dá para testar microfone, janelas do Windows, DPAPI, a contenção de processos do Windows nem o `.exe`. Mantenha a lógica em pacotes testáveis em Linux; testes específicos do Windows e o build do `.exe` rodam no GitHub Actions (`windows-latest`).
- Nunca commitar segredos (`.env*`, chaves, tokens, bancos). O `.gitignore` já cobre os casos comuns.
- A imagem da nuvem vem com Node 22 e npm 10, que o projeto recusa (`EBADDEVENGINES`). Antes de instalar ou testar: `npm install -g npm@11.21.0` (versão exata e já madura; a instalação global não passa pelo `min-release-age` do projeto).

## Git

- Trabalhe em branch e abra PR; não faça push direto na `main`.
- Não adicione linha `Co-Authored-By` nos commits (preferência do dono do projeto).
- Mensagens de commit no padrão *Conventional Commits*: `tipo(escopo opcional): descrição`. O tipo é em inglês e a descrição em português, no imperativo, curta e sem ponto final. Ex.: `feat(gate): adiciona regras deny/ask/allow`, `fix(db): corrige migração da tabela memories`.

  | Tipo | Quando usar |
  |---|---|
  | `feat` | funcionalidade nova |
  | `fix` | correção de bug |
  | `docs` | só documentação |
  | `refactor` | mudança de código sem mudar comportamento |
  | `test` | testes novos ou ajustados |
  | `chore` | manutenção (dependências, configuração, arquivos de suporte) |
  | `build` | build, empacotamento, instalador |
  | `ci` | GitHub Actions e automações |
  | `perf` | desempenho |
  | `style` | formatação, sem mudar lógica |

  Escopos sugeridos: `core`, `gate`, `executor`, `tools`, `db`, `memory`, `voice`, `models`, `integrations`, `ui`, `desktop`, `docs`, `security`. Mudança que quebra compatibilidade leva `!` (ex.: `feat(db)!: …`). Mudança no Porteiro ou na política de segurança usa o escopo `gate` ou `security`.

## Comandos

Gerenciador: **npm 11.16 ou mais novo** (workspaces). Não use pnpm nem yarn. Regras em `.npmrc` e na decisão 0009.

- `npm install`: instala. Versões novas só entram com 3 dias ou mais de publicadas, e nenhum script de instalação de dependência roda.
- `npm run dev:hologram`: abre o laboratório do holograma em `http://localhost:5173`.
- `npm run lint` · `npm run typecheck` · `npm test` · `npm run build`: o mesmo que o CI roda (o CI usa `npm ci`).
- Dependência nova num pacote: `npm install <pacote> -w packages/hologram` (ou `-w apps/hologram-lab`). Revise o diff do `package-lock.json` no PR.
- Dependência entre pacotes do projeto: declare como `"@jesus/<pacote>": "*"` (o npm não tem o protocolo `workspace:`).
- Pacote que precisa de script de instalação (módulo nativo, binário baixado): (1) revise o pacote; (2) `npm install <pacote>@<versão> -w <workspace>` (o script não roda); (3) `npm approve-scripts <pacote>` na raiz, que grava `pacote@versão` em `allowScripts`; (4) `npm rebuild <pacote> --ignore-scripts=false`, **sempre com o nome do pacote**. Cada versão nova precisa de aprovação nova. Nunca use `--dangerously-allow-all-scripts`.
- `npm run build:win`: ainda não existe (chega com o Electron, na fase 1).

## Estrutura

- `packages/hologram`: holograma (React Three Fiber). Lógica pura e testável em `model.ts`, `visual.ts`, `geometry.ts` e `describe.ts`; shaders em `shaders.ts`; cena em `react/`.
- `apps/hologram-lab`: protótipo da fase 0 (Vite + React + Zustand) com cenários roteirizados em `src/scenarios.ts`.

## Ao terminar uma tarefa

Rode os testes, atualize o documento afetado e descreva os riscos no PR.
