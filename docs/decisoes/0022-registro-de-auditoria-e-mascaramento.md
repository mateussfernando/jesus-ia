# 0022 — Registro de auditoria encadeado, mascaramento de segredos e logger com redação

- Status: aceita
- Data: 19/10/2026

## Contexto

A fase 1 precisa de um registro de auditoria antes de qualquer ferramenta ([plano da fase 1](../rascunhos/plano-fase-1.md), etapa 6; seções [3.13](../03-seguranca.md) e [3.16](../03-seguranca.md)). Três exigências:

- **O registro é só de acréscimo e mostra adulteração.** Mudar, tirar ou reordenar uma linha tem de aparecer. Uma cadeia de hash sozinha não pega o corte do fim do arquivo nem a reescrita do arquivo inteiro com os hashes refeitos.
- **Segredos nunca chegam ao modelo, ao registro, aos logs nem à memória** (invariante 5, seção 3.5). O filtro precisa ser o mesmo em todo lugar e idempotente: um texto mascarado duas vezes não pode mudar.
- **Dados de fora são dado, nunca instrução** (invariante 1). Arquivo lido, página e resultado de ferramenta vão ao modelo num bloco que o conteúdo não consegue fechar.

O hash do cartão de confirmação e das aprovações de ação, no rascunho do login (revisão 2), já pedia um JSON canônico definido, com os mesmos bytes na interface e no Executor.

## Decisão

Tudo fica no `packages/shared`. A raiz do pacote roda em qualquer ambiente; `@jesus/shared/audit` é só do Node.

- **`canonicalJson`:**
  - chaves em NFC, em ordem de ponto de código, sem espaços;
  - strings em NFC;
  - só inteiros seguros (fração, `NaN` e infinito lançam erro);
  - `undefined` fica de fora no objeto e lança erro no array;
  - só objetos simples (data, mapa, classe e ciclo lançam erro).
  - Vetores do rascunho do login nos testes.

- **`maskSecrets`:** troca cada segredo por `[segredo removido: <tipo>]`. Cobre:
  - chaves com prefixo: Anthropic, OpenAI, GitHub (incluindo `ghs_` e `github_pat_`), Google (incluindo `GOCSPX-`), Slack, AWS, Stripe, npm, Hugging Face, Groq e xAI;
  - `Bearer`, JWT, chave privada PEM e senha em URL de conexão;
  - senha por atribuição (`senha: x`) e por proximidade (palavra-chave a até 6 palavras antes de um valor com dígito ou símbolo);
  - código de verificação, código de login do device flow e código de segurança do cartão;
  - cartão que passa no Luhn, reduzido a `[cartão •••• 1234]`;
  - token de alta entropia: 24 caracteres ou mais, com letra e dígito, entropia de 4 bits por caractere ou mais, sem `/` (caminho e URL não são token) e sem hexadecimal puro (hash não é segredo).
  - Idempotente por construção: o texto é mascarado de novo até nenhuma regra achar nada, e as marcas já postas são protegidas. Os testes conferem isso em 400 textos aleatórios, com semente fixa.
  - A frase-semente (BIP-39) fica para a memória automática, que vai precisar das listas de palavras.

- **`escapeForPrompt` e `wrapUntrusted`:**
  - tiram os invisíveis que o modelo lê e o usuário não vê: tags Unicode, largura zero, controles de direção e BOM;
  - trocam `<` e `>` pelos de largura total;
  - embrulham o conteúdo em `<dados-externos origem="...">`, com a origem conferida.
  - O mascaramento vem antes e fica com quem chama, que registra o que foi mascarado.

- **Logger com redação** (`createLogger`):
  - campo com nome de segredo (senha, token, cookie, autorização, chave de API, credencial, código de recuperação) sai inteiro;
  - toda string passa pelo `maskSecrets` e é cortada em 2.000 caracteres;
  - erros viram nome, mensagem e pilha mascarados;
  - profundidade, chaves e itens têm teto, e o logger nunca lança.
  - O processo principal usa esse logger; a saída do `jesus-next` também passa pelo `maskSecrets`.

- **Registro de auditoria** (`@jesus/shared/audit`):
  - **Formato:** JSONL. Cada linha é o JSON canônico de `{ v, seq, ts, prev, event, hash }`. O `hash` é o SHA-256 do JSON canônico da entrada sem ele, e o `prev` é o hash da entrada anterior (64 zeros na primeira).
  - **Eventos:** passam pela mesma redação do logger, e fração vira texto.
  - **Âncora:** `{ seq, hash }` da última entrada, guardada fora do arquivo. Pega o corte do fim, a troca do arquivo e a reescrita com os hashes refeitos. Ao abrir, o arquivo inteiro é conferido contra ela.
  - **Gravação:** uma linha por vez, numa fila. Cada linha vai ao disco (`fsync`) antes de a âncora avançar. Se o app cair entre os dois passos, a âncora fica uma entrada atrás (`ahead`) e alcança o fim na próxima abertura. Uma linha incompleta no fim é cortada, e o corte fica registrado (`audit.recovered`).
  - **Adulteração:** cadeia quebrada, arquivo cortado ou linhas sem âncora fazem o arquivo ir para o lado como prova (`audit.jsonl.adulterado-<data>`). Um registro novo começa com `audit.chain_broken`, ligado à última âncora boa. A primeira linha de um arquivo só pode começar do zero ou religar assim, então cortar o começo também aparece.
  - **Falha de gravação:** o escritor para de gravar, porque o estado do arquivo fica incerto. Na fase 1, sem ferramentas, o app segue e registra o erro no log. A partir da etapa 13, ferramenta não roda sem registro.
  - **Arquivos:** `audit.jsonl` e `audit-anchor.json`, na pasta de dados (`%LOCALAPPDATA%\Jesus\data`).
  - **Eventos de hoje:** abertura do app, servidor da interface pronto, caído, com falha ou desistindo, violações da janela, disjuntor e página caída.
  - **O que não se grava:** nada é gravado se o app for aberto como administrador, porque arquivo criado elevado fica de dono errado.

- **Âncora provisória:** até a etapa 8, a âncora fica num arquivo ao lado do registro (troca atômica). Na etapa 8, ela vai para o cofre (`safeStorage`, DPAPI), como o plano manda.

## Consequências

- Mudar, tirar ou reordenar linhas, cortar o começo ou o fim e trocar o registro por outro aparecem na abertura seguinte. A prova fica guardada, e o registro continua.
- **Limite:** um programa rodando como o usuário consegue reescrever o arquivo e a âncora juntos. Isso vale para a âncora num arquivo e também no DPAPI, que esse programa consegue usar (seção 3.5). O registro mostra adulteração feita por quem não conhece a âncora, como um comando do agente ou uma edição à mão; não segura um atacante que já roda como o usuário. Contra o próprio agente valem as regras de negação das pastas do Jesus (seção 3.4.3) e a invariante 7.
- O mascaramento é heurístico: há falso positivo (um número de 4 a 8 dígitos perto de "código" some) e falso negativo (senha só de letras, sem palavra-chave antes). Errar para o lado de mascarar demais é aceito.
- Hash e identificador em hexadecimal não são mascarados. Chave de API em hexadecimal só é pega por atribuição ou proximidade.
- O registro ainda não tem rotação nem limite de tamanho; isso volta na etapa 14 (tela do registro).

## Detalhes

`packages/shared/src/` (`canonical-json.ts`, `mask-secrets.ts`, `untrusted.ts`, `logger.ts`, `audit/chain.ts`, `audit/writer.ts`) · `apps/desktop/src/main/audit-anchor.ts` · `apps/desktop/src/main/index.ts` · seções [3.5](../03-seguranca.md), [3.13](../03-seguranca.md) e [3.16](../03-seguranca.md)
