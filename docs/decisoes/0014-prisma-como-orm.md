# 0014 — Prisma como ORM do PostgreSQL

- Status: aceita
- Data: 10/10/2026
- Substitui: a escolha do Drizzle ORM na seção 4.3 (que ainda não tinha sido usado em código)

## Contexto

O dono do projeto pediu o Prisma como ORM do banco SQL. O banco continua o PostgreSQL local com pgvector ([decisão 0004](0004-postgresql-local.md)); a seção 4.3 indicava o Drizzle, que ainda não tinha entrado no código.

Testes de 10/10/2026 com o Prisma 7.10 (a versão estável; a etiqueta `latest` do pacote `prisma` aponta para um candidato da versão 8, que não é usado):

- O cliente do Prisma 7 não tem mais motor nativo: a consulta é compilada em TypeScript/WASM e vai ao banco pelo driver `pg`, através do adaptador `@prisma/adapter-pg`. Funcionou contra um PostgreSQL 16 local.
- O cliente é gerado como código TypeScript numa pasta escolhida pelo projeto (`prisma generate`).
- Mesmo com `ignore-scripts=true`, a **CLI** do Prisma baixa sozinha, de `binaries.prisma.sh`, um binário nativo (o *schema engine*, ~23 MB) na primeira vez que roda, por fora do `package-lock.json`. O `prisma generate` não usa esse binário: com a variável `PRISMA_SCHEMA_ENGINE_BINARY` apontando para um executável qualquer, ele gera o cliente sem baixar nada.
- O Prisma não modela o tipo `vector` do pgvector, colunas `tsvector` geradas, gatilhos, papéis nem `GRANT`. Esses itens entram como `Unsupported("…")` no esquema e como SQL escrito à mão nas migrações. A migração gerada com `Unsupported("vector(1024)")` saiu correta.

## Decisão

- **ORM:** Prisma 7.10 (versão fixada), gerador `prisma-client` com saída em `packages/db/src/generated/prisma` (fora do git; gerado antes de tipos, testes e build), adaptador `@prisma/adapter-pg` sobre o `pg`. Pacote `packages/db` (`@jesus/db`).
- **Esquema** em `packages/db/prisma/schema.prisma`, com nomes em inglês (decisão 0007) e `@@map`/`@map` para tabelas e colunas em `snake_case`.
- **Migrações** são arquivos SQL versionados (`packages/db/prisma/migrations/*/migration.sql`), revisados no PR como o `package-lock.json`. O que o Prisma não modela (pgvector, `tsvector`, `CHECK`, gatilhos da auditoria, papéis e privilégios por coluna da seção 5.3) é escrito à mão nesses arquivos.
- **No PC do usuário, quem aplica as migrações é o próprio Jesus**, com um migrador pequeno do `packages/db` (`pg`, transação por migração, soma de verificação SHA-256 de cada arquivo, tabela `jesus_migrations`). O app instalado não leva a CLI do Prisma nem o binário nativo dela.
- **A CLI completa** (`prisma migrate dev`, `migrate diff`) é ferramenta de desenvolvimento, usada só para gerar o SQL de uma migração nova. Ela baixa o binário nativo do Prisma; isso é aceito só na máquina de quem desenvolve, com a versão fixada, e nunca no CI. O CI só roda `prisma generate`, sem rede para binários.
- **Busca vetorial e textual** (seção 5.6) ficam em SQL cru e parametrizado (`$queryRaw` com *template* marcado, nunca `$queryRawUnsafe` com texto montado), dentro de repositórios do `packages/db`. O modelo de IA continua sem escrever SQL (seção 5.3).
- **Papéis** (`jesus_owner`, `jesus_app`, `jesus_config` e os dos rascunhos) continuam valendo: cada processo abre o seu próprio cliente com a sua conexão.

## Consequências

- Esquema tipado e um cliente com tipos gerados para todo o projeto.
- Duas fontes para manter em sincronia: o `schema.prisma` e o SQL das migrações. Uma checagem de deriva (`prisma migrate diff`) roda na máquina de quem desenvolve antes do PR, porque precisa do binário nativo.
- O binário nativo da CLI do Prisma é uma exceção consciente à regra de "nada de binário baixado fora do lockfile" (seção 3.14), limitada ao desenvolvimento.
- Testes do banco rodam contra um PostgreSQL de verdade quando `JESUS_TEST_DATABASE_URL` existe (no CI, um contêiner de serviço); sem ela, os testes de integração são pulados e os de lógica pura rodam.
- O cliente gerado não vai para o git, então todo comando que precisa dele (`typecheck`, `test`, `build` do `packages/db`) gera antes.

## Detalhes

[05-dados-postgresql.md](../05-dados-postgresql.md) · [04-tecnologias.md](../04-tecnologias.md) (seções 4.3, 4.7 e 4.9) · [03-seguranca.md](../03-seguranca.md) (seção 3.14) · `packages/db`
