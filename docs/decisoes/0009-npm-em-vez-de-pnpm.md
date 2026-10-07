# 0009 — npm workspaces em vez de pnpm

- Status: aceita
- Data: 07/10/2026
- Substitui: a escolha do pnpm nas decisões [0002](0002-typescript-e-electron.md) e [0008](0008-holograma-como-pacote-e-laboratorio.md)

## Contexto

O dono do projeto prefere usar o npm, que já vem com o Node, a instalar o pnpm. As decisões 0002 e 0008 escolheram o pnpm, em parte pelas proteções de cadeia de suprimentos (seção 3.14): atraso para versões novas (`minimumReleaseAge`) e scripts de instalação bloqueados por padrão. Em outubro de 2026, o npm 11 tem equivalentes:

- `min-release-age` (desde o npm 11.10): só instala versões publicadas há pelo menos N dias;
- política `allowScripts` no `package.json` com `strict-allow-scripts` (desde o npm 11.16): script de instalação de pacote não aprovado faz a instalação falhar; aprovar é `npm approve-scripts <pacote>`;
- `allow-git=none`: nenhuma dependência vinda direto de repositório git.

Versões antigas do npm **ignoram essas opções em silêncio**. O Node 24.21 LTS traz o npm 11.19; o Node 22 ainda traz o npm 10.

## Decisão

- Monorepo com **npm workspaces** (`packages/*`, `apps/*`) e `package-lock.json`; sem pnpm nem yarn.
- `.npmrc` do projeto: `engine-strict=true`, `min-release-age=3`, `strict-allow-scripts=true`, `allow-git=none`.
- `allowScripts` vazio no `package.json`: hoje nenhuma dependência precisa de script de instalação.
- O projeto exige **npm 11.16 ou mais novo** de duas formas, para as proteções nunca sumirem sem aviso: `engines.npm` com `engine-strict` (bloqueia `npm install` e `npm ci`) e `devEngines.packageManager` (bloqueia também `npm run`). Testado: o npm 10.9 recusa os dois.
- CI com `npm ci` no Node 24.

## Consequências

- Nada além do Node para instalar; quem tiver o Node 22 precisa atualizar o npm (`npm install -g npm@11`) ou instalar o Node 24 LTS.
- Na fase 1, o Electron precisa do script de instalação dele (baixa o binário): será aprovado com `npm approve-scripts electron`, depois de revisado, e a aprovação fica registrada no `package.json`.
- O npm cria links simbólicos para os pacotes do workspace e "eleva" as dependências para a raiz; um pacote pode importar algo que não declarou sem erro (o pnpm acusava). A revisão de PR precisa conferir as dependências declaradas.

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seção 3.14) · [04-tecnologias.md](../04-tecnologias.md) (seções 4.3 e 4.9)
