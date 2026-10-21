# 0026 — Ferramentas de leitura e pastas liberadas

- Status: aceita
- Data: 21/10/2026

## Contexto

A fase 1 termina com o Jesus lendo arquivos de uma pasta liberada ([roadmap, 10.1](../10-roadmap.md)). O Porteiro mínimo já decide pelo texto e pelo caminho real ([decisão 0021](0021-porteiro-minimo-para-leituras.md)). O [plano da fase 1](../rascunhos/plano-fase-1.md) (etapa 13) pede as três leituras no `jesus-executor` e liberar pasta só pelo diálogo nativo, com confirmação gerada por código e recusa de pastas amplas. Também deixa duas perguntas para o dono:
- **5:** busca só literal ou com expressão regular (motor linear)?
- **6:** ao liberar uma pasta, basta avisar que o conteúdo lido vai para a Anthropic, ou recusar as pastas pessoais (Documentos, Downloads, Área de Trabalho)?

O dono mandou seguir, e a recomendação foi adotada (ele pode mudar as duas respostas). Quatro fatos pesaram:
- **Um link plantado numa pasta liberada leva para qualquer lugar.** Num repositório baixado, por exemplo, `docs` pode ser um link para `\\servidor\pasta` ou `\\servidor@SSL\DavWWWRoot\…` (WebDAV por HTTPS, que passa por firewall). No Windows, só abrir o caminho já manda a credencial do usuário (NTLM) ao servidor. O `realpath` nativo também abre: conferir depois não basta.
- **Procurar no texto cru vira oráculo.** Se a busca achasse a linha de uma senha (mostrando a senha mascarada), a presença do resultado contaria ao modelo se a senha contém o texto procurado. Bastariam algumas buscas para descobri-la letra por letra.
- **As regras heurísticas de segredo pegam nomes de arquivo comuns.** `Screenshot_2023-10-15-12-34-56-789_com.whatsapp.jpg` virava "cartão" e `relatorio_final_v2_2023-10-15_revisado_marcos.docx` virava "token"; com o nome mascarado, o modelo não abre mais o arquivo.
- **O mascaramento era quadrático no número de achados.** Medido: 500 KB cheios de "senhas" levavam 9,5 s. O Executor mascara arquivos inteiros, e um arquivo assim prenderia o processo.

## Decisão

- **Três ferramentas, só de leitura.** Na API, os nomes são `file_read`, `file_list` e `file_search` (a API não aceita ponto em nome de ferramenta). O catálogo (`@jesus/executor/catalog`, sem disco) tem:
  - a descrição, que diz ao modelo que o conteúdo é dado, nunca instrução;
  - o esquema estrito da entrada;
  - os efeitos: leitura, reversível, não manda nada para fora, sensibilidade média;
  - o resumo feito por código com os parâmetros de verdade, sem invisíveis.

  O Cérebro declara as ferramentas com o catálogo; o principal e o Executor conferem cada chamada com o mesmo esquema.
- **Abrir, em cinco passos** (`open.ts`), cumprindo o que a decisão 0021 pede ao Executor:
  1. **O caminho pedido**, só pelo texto.
  2. **O passeio nome a nome**, com `lstat`, sem deixar o sistema seguir link nenhum. Cada link é lido (`readlink`), e o caminho a que ele leva (o alvo junto com o resto do pedido) passa pelo Porteiro (`checkLinkTarget`) antes de ser tocado. Se levar à rede, a um dispositivo, ao sensível, à pasta do Jesus ou para fora das pastas liberadas, nem é aberto. O passeio segue no máximo 32 links.
  3. **O caminho real, o tipo e o número de nomes**, pelo Porteiro, ainda antes de abrir. Hardlink e pipe nem são abertos (abrir um pipe trava).
  4. **Abre** sem seguir link no último nome e sem travar (`O_NOFOLLOW` e `O_NONBLOCK`, onde o sistema tem). Confere que o `dev` e o `ino` do arquivo aberto são os do passeio.
  5. **O `realpath` nativo** (junção, nome curto, unidade de rede ou `subst` que o texto não mostra). Confere de novo o mesmo arquivo (`dev` e `ino`) e passa pelo Porteiro com esse caminho e com o `nlink` do arquivo aberto.

  Só então o conteúdo é lido, do arquivo já aberto. Uma troca no disco entre os passos dá "o arquivo mudou; tente de novo".
- **`file_read`:**
  - **o que lê:** até 10 MB do começo do arquivo. Recusa binário (um byte zero nos primeiros 8 KB, ou UTF-32). Aceita UTF-8, UTF-16 com marca e, para arquivos antigos do Windows, Windows-1252.
  - **a máscara:** o texto lido inteiro é mascarado de uma vez, mantendo as quebras de linha. Assim, um pedaço do meio de uma chave PEM não escapa por ter ficado sem o cabeçalho, e a numeração continua certa.
  - **a resposta:**
    - linhas numeradas, até 2.000 por chamada (`offset` e `limit`);
    - cada linha cortada em 2.000 caracteres, e a resposta em 40 mil;
    - as notas do Jesus (que linhas vieram, onde continuar) ficam fora do bloco `<dados-externos>`.
- **`file_list`:**
  - **quanto mostra:** um nível só. Lê até 10 mil itens e mostra 500, em ordem de nome, como o Explorador do Windows.
  - **o que fica de fora:** as pastas do Jesus nem aparecem. O que é sensível aparece marcado, sem ser olhado.
  - **links:** aparecem como link. Só são lidos se levarem a uma pasta liberada.
  - **nomes estranhos:** caractere de controle ou invisível vira U+FFFD, e o item fica marcado. Um nome com quebra de linha não inventa uma linha na listagem.
- **`file_search` (pergunta 5: só literal):**
  - **como compara:** texto literal, sem diferenciar maiúsculas e com a mesma forma Unicode (NFC). Procura no conteúdo e nos nomes.
  - **por onde anda:** desce em profundidade, na ordem de nome, sem seguir links e sem atravessar para outro disco (ponto de montagem, como o `find -xdev`). Pula `.git`, `node_modules` e afins, binários, arquivos com mais de 2 MB, o sensível e as pastas do Jesus. Diz o que pulou.
  - **onde para:** em 10 níveis, 50 mil itens, 5 mil arquivos, 50 MB lidos, 100 resultados ou 10 segundos. Diz onde parou.
  - **sem oráculo:** compara com o texto **já mascarado**, então procurar um pedaço de um segredo não acha a linha dele. Só o arquivo que tem o texto antes da máscara é mascarado, para não pagar a máscara de todos.
  - **conferência por arquivo:** a pasta de partida passa pelos cinco passos. Daí para baixo, os caminhos vêm da própria listagem, e só se desce em pasta de verdade do mesmo disco. Cada arquivo passa pelo Porteiro (pasta do Jesus, sensível, hardlink) e é aberto conferindo `dev` e `ino`, sem o `realpath` de cada um.
- **Nomes de arquivo e de pasta** passam só pelas regras de segredo de alta confiança: chave privada, JWT, chave de API com prefixo e senha em URL de conexão (`HIGH_CONFIDENCE_SECRETS`). O conteúdo passa por todas.
- **O mascaramento ([decisão 0022](0022-registro-de-auditoria-e-mascaramento.md)) ganha três coisas:**
  - **custo linear:** os trechos escolhidos ficam ordenados, com busca binária. Medido: 500 KB passaram de 9,5 s para 0,2 s. O resultado é o mesmo do anterior em 30 mil textos sorteados.
  - **a opção `keepLines`**, que mantém as quebras de linha de um trecho mascarado.
  - **uma regra de base64 com barra**, que a regra de alta entropia não pegava: a chave secreta da AWS e as linhas do corpo de uma chave PEM. São 40 caracteres ou mais, com maiúscula, minúscula e dígito, no máximo uma barra a cada 16 caracteres e entropia de 4,5 bits ou mais (caminhos e URLs ficam de fora).
- **Falha em texto, sem o caminho.** `runTool` nunca lança. Erros do disco viram poucas classes (não achado, sem permissão, aberto por outro programa, mudou, links demais), e a mensagem do sistema, que leva o caminho, não vai ao modelo.
- **A política vem a cada chamada.** O principal manda as pastas liberadas e os lugares do sistema; o Executor não guarda estado.
- **Liberar pasta (pergunta 6: meio-termo):**
  - **quem libera:** só o dono, pelo diálogo nativo de escolher pasta. Nenhum caminho vem da página nem do modelo.
  - **o que o principal confere:** pega o caminho real (`realpath` nativo) e passa pelo Porteiro (`checkReleaseFolder`). Recusa:
    - a raiz de uma unidade, a pasta do usuário e as acima dela;
    - as pastas pessoais **inteiras** (Documentos, Downloads, Área de Trabalho, Imagens, Vídeos, Música; uma subpasta delas pode);
    - `AppData`, as pastas do sistema e dos programas;
    - as pastas do Jesus e as sensíveis.
  - **a confirmação:** vem depois, numa caixa nativa gerada por código. Mostra o caminho real e **sempre** avisa que o conteúdo lido vai para a Anthropic.
  - **o registro:** a liberação e a remoção vão para o registro de auditoria, e a lista de pastas liberadas é refeita a partir dele. Com o registro em quarentena, nenhuma pasta fica liberada (falha fechada).
  - **quando entra:** o fluxo no app chega com o `jesus-executor` e a tela (etapas 13c e 13d).

## Consequências

- **Testes:**
  - **no Linux:** pastas, links, hardlinks e trocas de verdade. Arquivo virando link entre o `lstat` e o `open` (o `O_NOFOLLOW` recusa), arquivo trocado por outro (o `dev`/`ino` pega), `realpath` que leva a outro arquivo ou para fora, pipe nunca aberto, e o lugar de fora nunca tocado.
  - **no Windows de verdade (CI):** junção para fora negada sem tocar o destino, links para SMB e WebDAV negados sem abrir nada, nome curto recusado sem tocar o disco, maiúsculas diferentes, hardlink.
- **Coleção de ataques:** `link-targets.json` (25 casos: rede, dispositivo, relativo ambíguo, fora, sensível, Jesus, nomes ambíguos).
- **Falsos positivos aceitos:**
  - num arquivo de código, um identificador longo com dígitos pode sair mascarado (regra de alta entropia);
  - de um arquivo maior que 10 MB, só o começo é lido;
  - a busca não acha texto que esteja dentro de um segredo (de propósito).
- **Limitações:**
  - **troca feita por um programa do próprio usuário** no meio da conferência. Ele já lê os arquivos sozinho e está fora do modelo de ameaças (seção 3.2). Por isso, a busca não refaz o `realpath` de cada arquivo, e uma subpasta trocada por link entre o `lstat` e a listagem não é pega.
  - **PDF, Word e planilhas** ficam para depois.
  - **Arquivos sob demanda do OneDrive** são baixados ao serem lidos.
  - **Um ponto de montagem de outro disco** dentro de uma pasta liberada é seguido pelo sistema na leitura e na listagem (o `realpath` nativo e o Porteiro decidem pelo destino), mas a busca não entra nele.
- O dono pode mudar as respostas 5 e 6; uma regra nova entra com caso novo na coleção.

## Detalhes

`packages/executor/src/` · `packages/gate/src/read-gate.ts` (`checkLinkTarget`) e `release.ts` · `packages/shared/src/mask-secrets.ts` · `security/attack-corpus/` · seções [3.4.4](../03-seguranca.md), [3.5](../03-seguranca.md) e [3.17](../03-seguranca.md)
