# 0020 — Cofre da chave no processo principal e tela Configurações

- Status: aceita
- Data: 19/10/2026 (revista em 20/10/2026, depois da revisão independente #3)

## Contexto

A fase 1 conversa com o Claude Haiku 5.5 ([decisão 0011](0011-primeiro-modelo-claude-haiku.md)) e precisa da chave da API da Anthropic. Ela é o segredo mais valioso do app até aqui: quem a tem gasta na conta do dono.

A seção [3.5](../03-seguranca.md) já define a regra: segredos ficam no `safeStorage` do Electron (DPAPI no Windows) e nunca no modelo, nos logs, na memória ou no ambiente dos comandos.

O [plano da fase 1](../rascunhos/plano-fase-1.md) (etapa 8) pede:
- o cofre no processo principal;
- a tela Configurações, que manda a chave pelo servidor da interface sem guardá-la;
- a recusa da chave de administrador;
- a âncora do registro de auditoria ([decisão 0022](0022-registro-de-auditoria-e-mascaramento.md)) dentro do cofre.

## Decisão

- **Cofre** (`apps/desktop/src/main/vault.ts`):
  - arquivo `vault.json` na pasta de dados, com cada valor cifrado pelo `safeStorage` síncrono, em base64;
  - **gravação atômica e durável** (`durable-file.ts`): o conteúdo vai para um temporário forçado ao disco (`fsync`) antes da troca de nome, e a pasta também (fora do Windows). No Windows, a troca de nome e a leitura que falham de passagem (`EPERM`, `EACCES`, `EBUSY`: antivírus ou indexador com o arquivo aberto) são repetidas por pouco mais de 1 s. Permissão 0600.
  - formato conferido com Zod estrito. Arquivo estragado dá erro na leitura; o cofre não adivinha nem apaga nada.
  - **Arquivo estragado não trava o cofre para sempre:** a próxima gravação pedida pelo dono (guardar ou apagar a chave) põe o arquivo de lado como prova (`vault.json.estragado-<data>`), recomeça o cofre vazio e registra `vault.reset`.
  - Entradas: `anthropic_api_key` (e, até a migração, a `audit_anchor` da versão anterior). Entradas de uma versão mais nova do Jesus são guardadas como vieram.
  - O texto aberto só existe na memória do principal, na hora de usar.
- **Onde o cofre recusa:**
  - sem cifra disponível (`isEncryptionAvailable`);
  - no Linux, com o chaveiro "senha embutida" (`basic_text`) ou desconhecido (`unknown`);
  - no Linux, blob que não seja `v11`. O `v10` é cifrado com uma senha fixa, conhecida.
  - No Windows, o DPAPI decide.
- **A chave aceita** (`checkAnthropicKey`, em `packages/shared`): só a de API comum, `sk-ant-apiNN-…`. A chave de administrador (`sk-ant-admin…`, sem diferenciar maiúsculas) gerencia a organização inteira e é recusada. A conferência é só de forma; se a chave vale, a primeira chamada à API diz.
- **Caminho da chave:**
  1. A página Configurações (`/configuracoes/`, protegida) manda a chave numa Server Action, que confere a sessão.
  2. A Server Action manda a chave ao principal pela ponte congelada ([decisão 0019](0019-bloqueio-pelos-eventos-do-windows.md)): mensagem `vault` com `id`, Zod estrito e no máximo 512 caracteres.
  3. O principal confere a forma de novo, guarda e responde `vault-reply`. A resposta diz só se há chave guardada (`present`, `absent` ou `unknown`), nunca a chave. Guardada só conta como `present` se abre: um blob que o `safeStorage` não decifra mais (pasta restaurada noutra máquina, perfil refeito) aparece como `unknown`, e a tela pede para guardar de novo.
  - No servidor da interface, a chave só passa: não fica em variável global, arquivo nem registro.
  - Sem resposta em 10 s, o pedido falha.
  - O campo da tela é de senha e se esvazia no envio.
- **Registro de auditoria:** guarda `vault.key_saved`, `vault.key_removed`, `vault.key_refused` (com o motivo) e `vault.reset`, sem a chave. Apagar a chave funciona até com o cofre indisponível, porque não precisa de cifra.
- **Ritmo:** guardar e apagar (inclusive as tentativas recusadas) aceitam até 20 pedidos por minuto; o excesso responde `failed`, sem gravar. As recusas vão ao registro no máximo uma vez por minuto, com a contagem das que ficaram de fora (`vault.throttled` avisa do excesso). Um servidor da interface comprometido não afoga o registro nem o disco.
- **Âncora do registro num arquivo cifrado próprio** (`audit-anchor.vault`, `audit-anchor.ts`), com o mesmo `safeStorage` e a mesma gravação durável, mas sem bloquear o principal. Ela é regravada a cada linha do registro; o arquivo da chave só muda quando o dono mexe na chave, e uma gravação estragada da âncora nunca leva a chave junto. Migração: sem esse arquivo, vale a âncora que estava no `vault.json` (etapa 8) e, sem ela, a do arquivo comum `audit-anchor.json` (etapas 6 e 7); a primeira gravação vai para o arquivo novo e apaga as antigas. Onde o cofre não funciona (Linux sem chaveiro, nos testes), a âncora continua no arquivo comum. Âncora que não se lê vale como ausente ([decisão 0022](0022-registro-de-auditoria-e-mascaramento.md)): o registro nunca deixa de abrir por causa dela.

## Consequências

- **Onde a chave pode estar:** no cofre (cifrada) e, de passagem, na memória do servidor da interface e do principal. Nunca vai para a página, para o registro, para os logs (o logger e o `maskSecrets` também a mascaram) nem para o ambiente dos filhos. O teste de ponta a ponta procura a chave falsa na tela, na saída do principal e em todos os arquivos da pasta de dados.
- **Limite do DPAPI** (seção 3.5): ele protege contra outros usuários do PC, não contra programas rodando como o dono. Por isso a chave deve ter limite de gasto no Console, e os comandos do agente não rodam como o dono sem contenção (seção 3.6).
- **Linux:** sem chaveiro do sistema, o cofre recusa. O contêiner e o CI do Linux só testam o caminho da recusa. O caminho com DPAPI (guardar, apagar, âncora no cofre) é testado no CI do Windows, no pacote de teste.
- **Etapa 9:** o principal lê a chave do cofre para injetar o `x-api-key` na saída para a API. O Cérebro nunca vê a chave.
- **Revisão independente #3 (20/10/2026):** a primeira versão guardava a âncora no `vault.json`, regravado a cada linha do registro sem `fsync`, e a leitura de um cofre estragado lançava erro na abertura do registro. Uma queda de energia na hora errada (arquivo zerado), um antivírus segurando o arquivo ou uma cifra que não abre mais desligavam o registro de auditoria e a API de vez, e a tela não tinha saída. As mudanças acima fecham esses caminhos, com testes para cada um.
- **Linux sem chaveiro numa sessão e com chaveiro na outra:** a âncora muda de lugar entre as aberturas, e a conferência põe o registro de lado sem adulteração (o gasto do dia vai junto, decisão 0023). O Linux é só de teste; no Windows, o DPAPI não alterna.

## Detalhes

`apps/desktop/src/main/vault.ts` · `apps/desktop/src/main/vault-requests.ts` · `apps/desktop/src/main/audit-anchor.ts` · `apps/desktop/src/main/durable-file.ts` · `apps/desktop/src/next-host/desktop-bridge.ts` · `apps/ui/src/app/(app)/configuracoes/` · `apps/ui/src/settings/` · `packages/shared/src/api-keys.ts` · seção [3.5](../03-seguranca.md)
