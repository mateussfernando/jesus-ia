# 0018 — Empacotamento com electron-builder: fusíveis, asar e instalador por usuário

- Status: aceita
- Data: 18/10/2026

## Contexto

A fase 1 termina com o `.exe` sem assinatura saindo como artefato do CI ([10.1](../10-roadmap.md)). O app de desktop (decisões [0016](0016-nextjs-com-servidor-dentro-do-electron.md) e [0017](0017-servidor-do-next-num-utilityprocess.md)) leva o processo principal, o servidor da interface num utilityProcess e o build standalone do Next.

Três cuidados guiam o empacotamento:

- **Ninguém deve conseguir usar o `.exe` do Jesus como outra coisa.** Exemplos: um Node genérico (`ELECTRON_RUN_AS_NODE`), um processo com depurador (`--inspect`, `--remote-debugging-port`) ou um app carregado de outro lugar. Na fase 3, o próprio agente vai rodar comandos no PC.
- **O pacote não pode levar segredos de quem desenvolve** (`.env`, a senha local de desenvolvimento) nem código de teste.
- **O que o build baixa precisa ser conferido.** Isso vale para o Electron e para as ferramentas do instalador.

A prova de 13/10/2026 mostrou que funciona o app empacotado com asar, fusíveis de produção e o standalone do Next dentro do `app.asar`, rodando num utilityProcess.

## Decisão

- **electron-builder 26.17.0** (versão exata, da linha `v26`), dependência só de desenvolvimento.
  - O app não leva nenhum `node_modules` do projeto: o processo principal e o servidor da interface vão empacotados pelo rolldown (`dist/`), com as dependências dentro.
  - A interface vai montada pelo `stage-ui.mjs`. Tudo fica dentro do `app.asar`.

- **Fusíveis do Electron no build de produção:**
  - desligados: `RunAsNode`, `NODE_OPTIONS`, `--inspect` e afins, o snapshot V8 do processo principal e os privilégios extras de `file:`;
  - ligados: cookies cifrados, integridade do asar embutida no executável (Windows) e "só carregar o app de dentro do asar".
  - Os fusíveis não cobrem `--remote-debugging-port`, e para isso o app recusa qualquer argumento (seção 3.13).

- **Dois builds, decididos na compilação:**
  - **Produção:** `dist/`, fusíveis travados.
  - **Teste:** `dist-test/` e fusíveis padrão, porque os testes de ponta a ponta usam o inspetor do Node e o CDP. Sai em `release-test/` e nunca é publicado. Ele também não recusa rodar como administrador, só registra (os runners Windows do GitHub rodam elevados). A produção recusa.
  - O build de produção falha se sobrar código de teste no bundle, e o pacote é conferido de novo.

- **Conferência do pacote** (`scripts/check-package.mjs`, em todo empacotamento e no CI):
  - fusíveis um a um (`@electron/fuses`);
  - conteúdo do `app.asar`: o bundle certo, a interface montada, nenhum `node_modules` do projeto, nenhum arquivo que o `stage-ui.mjs` recusaria e nenhum código de teste;
  - na produção, abrindo o app de verdade: ele sai com 2 diante de `--remote-debugging-port` e ignora `ELECTRON_RUN_AS_NODE`.

- **Instalador NSIS por usuário, sem administrador:**
  - um clique, em `%LOCALAPPDATA%\Programs\Jesus`;
  - `requestedExecutionLevel: asInvoker`;
  - sem `elevate.exe` e sem escolha de "todos os usuários";
  - desinstalar não apaga a pasta de dados.
  - Isso responde à pergunta 2 do plano da fase 1 com a proposta, que fica valendo até o dono decidir outra coisa.

- **Sem assinatura de código** (uso pessoal; o SmartScreen avisa na primeira vez). Sem atualização automática na fase 1.

- **Cadeia do que o build baixa:**
  - **O zip do Electron** é conferido com o `checksums.json` do pacote `electron`, fixado pelo `package-lock.json`. O mesmo vale para o binário que o `install.js` baixa nos testes.
  - **Exceção registrada:** no Windows, o electron-builder baixa do repositório `electron-userland/electron-builder-binaries` o NSIS, os recursos do NSIS, o 7zip e o winCodeSign (`rcedit`, para os dados do executável). Esses binários ficam fora do lockfile, mas cada um é conferido por um SHA-256 fixo no código do `app-builder-lib` 26.17.0. Por exemplo, `nsis-3.0.4.1.7z` = `9877df90…`. Trocar de versão do electron-builder exige rever essa lista.
  - O `electron-winstaller` (alvo Squirrel, que não usamos) tem script de instalação: fica recusado em `allowScripts`.
  - O `npm audit` acusa 8 alertas moderados da cadeia `@electron/get` → `global-agent` → `roarr` → `sprintf-js` 1.1.3 (negação de serviço com formato malicioso). É uma ferramenta só de build, que formata texto nosso; fica registrado e é reavaliado a cada atualização.

## Consequências

- O `.exe` não serve de Node genérico, não abre com depurador e não carrega app de fora do asar. Mexer no `app.asar` quebra a integridade no Windows: o teste de adulteração do CI (`windows-latest`, `scripts/tamper-check.mjs`) troca um byte de um comentário do `dist/main.mjs` dentro do asar, e o Electron recusa abrir (a cópia intacta roda e recusa o argumento de teste).
- O instalador por usuário não pede administrador, condizente com a invariante 6 (o Jesus também recusa abrir elevado). Em compensação, o app fica na pasta do usuário, que outro programa do mesmo usuário consegue alterar. A integridade do asar e a recusa de argumentos reduzem esse risco, mas não o eliminam.
- O empacotamento do Windows (NSIS) só roda no Windows. No Linux, o CI gera e confere a pasta `linux-unpacked` (produção e teste) e roda os testes de ponta a ponta no pacote de teste.
- Os ~250 pacotes do electron-builder são só de desenvolvimento e não vão para o app.

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seções 3.13 e 3.14) · [04-tecnologias.md](../04-tecnologias.md) (seção 4.4) · [plano da fase 1](../rascunhos/plano-fase-1.md) (etapas 4 e 5) · `apps/desktop/electron-builder.config.cjs` · `apps/desktop/scripts/package.mjs` · `apps/desktop/scripts/check-package.mjs`
