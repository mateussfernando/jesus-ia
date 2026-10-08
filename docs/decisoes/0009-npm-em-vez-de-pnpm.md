# 0009 — npm workspaces em vez de pnpm

- Status: aceita
- Data: 07/10/2026 (revisada em 08/10/2026 depois de uma revisão adversarial)
- Substitui: a escolha do pnpm nas decisões [0002](0002-typescript-e-electron.md) e [0008](0008-holograma-como-pacote-e-laboratorio.md)

## Contexto

O dono do projeto prefere usar o npm, que já vem com o Node, a instalar o pnpm. As decisões 0002 e 0008 escolheram o pnpm, em parte pelas proteções de cadeia de suprimentos (seção 3.14): atraso para versões novas (`minimumReleaseAge`) e scripts de instalação bloqueados por padrão.

Em outubro de 2026, o npm tem recursos equivalentes:

- `min-release-age` (desde o npm 11.10): ao escolher versões, só aceita as publicadas há pelo menos N dias.
- `ignore-scripts`: nenhum script de dependência roda.
- Política `allowScripts` no `package.json` com `strict-allow-scripts` (desde o npm 11.16): script de pacote não aprovado faz a instalação falhar. Aprovar é `npm approve-scripts <pacote>`.
- `allow-git=none`: nenhuma dependência vinda direto de repositório git (o pnpm, com a configuração anterior, aceitava uma dependência git transitiva).

A revisão adversarial de 08/10/2026 testou tudo isso com npm 10, 11 e 12 e um registry simulado, e achou três limites:

1. A política `allowScripts` sozinha **não pega** scripts de dependências embutidas (`bundleDependencies`) nem a compilação nativa implícita de um pacote com `binding.gyp` e sem script declarado. O pnpm bloqueava os dois.
2. Versões antigas do npm ignoram as opções novas: o npm 10 sem nenhum aviso; o npm 11 anterior ao 11.16 com um aviso de opção desconhecida, mas segue sem a proteção. O Node 22 ainda traz o npm 10, e o Node 24 só traz o npm 11.16+ a partir do 24.18.
3. O npm não tem o protocolo `workspace:`. Uma dependência interna `@jesus/*` cuja faixa deixe de bater com a versão local seria buscada no registry público, onde o escopo `@jesus` existe e não é nosso.

## Decisão

- Monorepo com **npm workspaces** (`packages/*`, `apps/*`) e `package-lock.json`; sem pnpm nem yarn.
- `.npmrc` do projeto:
  - `engine-strict=true`;
  - `min-release-age=3`;
  - `ignore-scripts=true`, que fecha o limite 1. Testado: dependência embutida com `postinstall`, `binding.gyp` implícito, script declarado direto e transitivo, e script só no tarball (*manifest confusion*): nenhum rodou em `npm install` nem em `npm ci`;
  - `strict-allow-scripts=true`, segunda barreira quando um script for liberado à mão;
  - `allow-git=none`;
  - `@jesus:registry=https://registry.invalid/`, que fecha o limite 3: pacote `@jesus/*` só vem do workspace.
- `allowScripts` no `package.json`: hoje só `"fsevents": false` (dependência opcional do Vite no macOS, recusada de forma explícita).
- O projeto exige **npm 11.16 ou mais novo** de duas formas, para as proteções nunca sumirem sem aviso (limite 2):
  - `engines.npm` com `engine-strict`, que bloqueia `npm install` e `npm ci` mesmo em npm antigos;
  - `devEngines.packageManager`, que bloqueia também `npm run`.
  - Testado: o npm 10.9 e o 11.15 recusam; o 11.16, o 11.17 e o 11.21 instalam e passam nos testes.
- Node: `^22.13.0 || >=24` (as dependências exigem 22.13+). O recomendado é o Node 24 LTS atual.
- Dependência entre pacotes do projeto declarada como `"*"`.
- Liberar um script (módulo nativo, binário baixado): revisar, instalar (o script não roda), `npm approve-scripts <pacote>` (aprovação fixada na versão) e `npm rebuild <pacote> --ignore-scripts=false`, **sempre com o nome**. Sem o nome, o rebuild roda os scripts de todos os pacotes, inclusive os embutidos. Cada versão nova precisa de aprovação nova.
- CI com `npm ci` no Node 24.

## Consequências

- Nada além do Node para instalar. Quem tiver Node 22 ou um Node 24 anterior ao 24.18 precisa atualizar o Node (o mais simples) ou o npm (`npm install -g npm@11.21.0`, versão exata, porque a instalação global não passa pelo `min-release-age` do projeto). As sessões na nuvem fazem isso no começo (ver `CLAUDE.md`).
- O `min-release-age` vale quando o npm escolhe versões; o que já está no lockfile é instalado como está. Por isso, todo PR que muda o `package-lock.json` tem o diff revisado.
- Perde-se o isolamento estrito do pnpm: o npm "eleva" as dependências para a raiz, e um pacote pode importar algo que não declarou sem erro. A revisão de PR confere as dependências declaradas.
- O `npm run <script> --workspaces` roda na ordem do campo `workspaces` (e alfabética dentro de cada pasta), não em ordem de dependência como o `pnpm -r`. Hoje não importa, porque os pacotes são consumidos pelo código-fonte TypeScript. Se um pacote passar a gerar build consumido por outro, encadear os builds no script da raiz.
- O npm 12 (latest desde 30/09/2026) é aceito; ele exige Node ^22.22.2, ^24.15 ou 26+.

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seção 3.14) · [04-tecnologias.md](../04-tecnologias.md) (seções 4.3 e 4.9) · `.npmrc` e `package.json` da raiz · `CLAUDE.md` (Comandos e Ambiente)
