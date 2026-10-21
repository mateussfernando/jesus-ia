# 0021 — Porteiro mínimo para a leitura de arquivos

- Status: aceita
- Data: 21/10/2026

## Contexto

A fase 1 termina com o Jesus lendo arquivos de uma pasta liberada ([roadmap, 10.1](../10-roadmap.md)). Pela invariante 2, quem decide se uma leitura acontece é o Porteiro (`packages/gate`), fora da IA; o Executor só executa. O [plano da fase 1](../rascunhos/plano-fase-1.md) (etapa 12) pede um Porteiro mínimo e determinístico para isso, antes das ferramentas (etapa 13):
- caminhos do Windows normalizados (seção 3.4.2);
- leitura só dentro das pastas liberadas;
- leitura sensível e pastas do Jesus negadas (inclui `.jesus-dev`, os dados em `%LOCALAPPDATA%\Jesus` e a instalação em `%LOCALAPPDATA%\Programs\Jesus`);
- hardlinks negados;
- a semente da coleção de ataques (`security/attack-corpus`).

Dois fatos pesaram:
- **Abrir um caminho já é uma ação.** No Windows, abrir `\\servidor\pasta` dispara acesso à rede (SMB, e o WebDAV escondido), e o mesmo texto pode apontar para lugares diferentes: nome curto 8.3 (`PROGRA~1`), fluxo alternativo (`a.txt:escondido`), ponto ou espaço no fim (`a.txt.` abre `a.txt`), nome de dispositivo (`NUL.txt`), prefixos `\\?\` e `\\.\`.
- **O texto não diz para onde o caminho leva.** Links simbólicos e junções levam para fora da pasta liberada, e um hardlink é o mesmo arquivo com outro nome: o caminho real (`realpath`) de um hardlink é o do próprio link.

## Decisão

- **Lógica pura, sem disco** (`packages/gate`): o Porteiro decide com o que lhe entregam e nunca lê o ambiente sozinho. Quem toca o disco é o Executor (etapa 13).
- **Duas conferências:**
  1. **O caminho pedido** (`checkRequestedPath`), antes de o Executor abrir qualquer coisa, só pelo texto;
  2. **O caminho real** (`checkResolvedPath`), depois que o Executor abriu: o destino depois de links, junções e nomes curtos, o tipo (arquivo, pasta ou outra coisa) e o número de nomes do arquivo (`nlink`). O pedido é conferido de novo nessa hora (a política pode ter mudado no meio).
- **O texto ambíguo é recusado, não adivinhado** (`path.ts`):
  - só caminho absoluto com unidade (`C:\…`); relativo, relativo à unidade (`C:pasta`) e relativo à raiz (`\pasta`) são recusados;
  - caminho de rede, `\\?\`, `\\.\` e `\??\` são recusados;
  - dois-pontos fora da unidade (fluxo alternativo), `< > " | ? *`, nome terminado em ponto ou espaço, nome de dispositivo (`CON`, `NUL`, `COM1`, `LPT1`, com ou sem extensão) e nome curto 8.3 são recusados;
  - caracteres de controle, formatação invisível (inversão de direção, largura zero) e metade solta de um par de surrogates são recusados;
  - `.` e `..` são resolvidos pelo texto, como o Windows faz (`..` acima da raiz fica na raiz), e todo nome é conferido, até os que um `..` depois tira;
  - a comparação não diferencia maiúsculas, letra por letra como o NTFS (`ß` não vira `SS`), e é feita nome a nome (`C:\site` não contém `C:\site2`).
- **A ordem das regras** (em cada conferência): pasta do Jesus → leitura sensível → fora das pastas liberadas. `deny` vence tudo: a negação vale se o caminho pedido **ou** o real casar; a liberação exige os dois dentro de uma pasta liberada.
- **Pastas do Jesus:** `%LOCALAPPDATA%\Jesus` (e a do build de teste), `%LOCALAPPDATA%\Programs\Jesus`, as que o principal informar (a pasta de dados e a da instalação de verdade) e qualquer `.jesus-dev`.
- **Leitura sensível** (`sensitive.ts`, seção 3.4.3), mesmo dentro de uma pasta liberada:
  - pastas que só guardam segredo, em qualquer lugar: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.password-store`;
  - arquivos: `.env`, `.env.*` e `.envrc`; chaves privadas (`id_rsa`, `id_ed25519`… e `.pem`, `.key`, `.pfx`, `.p12`, `.ppk`, `.jks`, `.keystore`); cofres de senha (`.kdbx`, `.kdb`…); `wallet.dat`;
  - na pasta do usuário: `.config\gcloud`, `.docker\config.json`, `.git-credentials`, `.npmrc`, `.pypirc`, `.netrc`, `.pgpass` e o registro do usuário (`NTUSER.*`);
  - perfis de navegador e de e-mail (Chrome, Edge, Brave, Vivaldi, Chromium, Yandex, Firefox, Opera, Thunderbird);
  - segredos do Windows (DPAPI em `Microsoft\Protect`, Gerenciador de Credenciais, `Microsoft\Crypto`, `SystemCertificates`, o registro do sistema em `System32\config`);
  - cofres de senha (1Password, Bitwarden), carteiras (Bitcoin, Electrum, Ethereum, Exodus, Atomic) e sessões de aplicativos de conversa (Discord, Telegram, Signal, Slack).
- **Tipo e número de nomes:** pediu arquivo e é pasta (ou o contrário) nega; outra coisa (dispositivo, pipe) nega; arquivo com mais de um nome nega, e número sem sentido também (falha fechada). Pasta pode ter qualquer número de nomes.
- **Fora das pastas liberadas, a fase 1 nega.** A pergunta da seção 3.4.4 ("primeira leitura fora → pergunta") chega com os cartões de confirmação.
- **A negação em texto** (`describeDenial`), para o modelo e para a tela, nunca repete o caminho (ele pode ter vindo de conteúdo externo).
- **A coleção de ataques** (`security/attack-corpus/read-paths.json`): cada caso diz o caminho pedido, o que o disco mostraria e a decisão esperada. Roda no `npm test` e sozinha com `npm run attack-corpus`. Conferido: tirar a conferência do caminho real, a do hardlink ou a do nome curto faz casos da coleção falharem.

## Consequências

- **Testes:** a leitura dos caminhos (cada recusa e a comparação), as regras, a negação em texto e a coleção de ataques (73 casos).
  - **No Windows de verdade** (CI, `windows-latest`): o `realpath` nativo leva a junção para fora (e o Porteiro nega), resolve o nome curto para o longo, e um hardlink mostra o próprio caminho como real, com `nlink` 2 (e o Porteiro nega).
- **O Executor (etapa 13) tem de** chamar as duas conferências, abrir sem seguir nada antes da primeira, usar o `realpath` nativo e o `nlink` do arquivo aberto, e conferir que o arquivo lido é o mesmo que foi conferido (`dev` e `ino`).
- **Falso positivo aceito:** um arquivo de projeto com nome que parece nome curto (`Notas~2.txt`), `.env.example` e certificados públicos em `.pem` são negados. O dono pode pedir mudança; uma regra nova entra com caso novo na coleção.
- **Leitura de rede, dispositivos e fluxos alternativos fica fora** da fase 1.
- **Revisão independente:** o plano recomenda uma depois desta etapa (as regras de leitura).
- **Caminhos POSIX** (desde a etapa 13): o mesmo Porteiro aceita caminhos do Linux, só para os testes e o desenvolvimento (o CI e as sessões na nuvem rodam em Linux). Mesmas recusas de texto escondido, só absoluto, sem `\`, e comparação diferenciando maiúsculas, como o Linux; as regras de nomes sensíveis valem em qualquer caixa.

## Detalhes

`packages/gate/src/` (`path.ts`, `places.ts`, `sensitive.ts`, `read-gate.ts`, `describe.ts`) · `security/attack-corpus/` · seções [3.4.2 a 3.4.4](../03-seguranca.md) e [3.17](../03-seguranca.md)
