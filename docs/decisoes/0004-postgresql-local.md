# 0004 — PostgreSQL local embutido + pgvector

- Status: aceita
- Data: 07/10/2026

## Contexto

O Jesus vai guardar "tudo" sobre o usuário: conversas, memórias, contatos, auditoria. O dono do projeto pediu PostgreSQL e quer tudo rodando localmente, sem hospedar nada.

## Decisão

PostgreSQL 18 + pgvector 0.8.x, com os binários empacotados no app e o banco iniciado como processo filho, escutando só em `127.0.0.1`, com `scram-sha-256` e senha aleatória guardada no cofre do Windows. Papéis separados (`jesus_owner`, `jesus_app`, `jesus_config`); auditoria só de acréscimo. Desenvolvimento com Docker (`pgvector/pgvector:pg18`); testes rápidos podem usar PGlite.

## Consequências

- Postgres de verdade, com busca semântica e busca textual em português num banco só.
- O pgvector precisa ser compilado para Windows e empacotado junto (os binários do embedded-postgres não o trazem).
- O app precisa gerenciar o ciclo de vida do processo do banco e os backups.

## Detalhes

[05-dados-postgresql.md](../05-dados-postgresql.md) · [03-seguranca.md](../03-seguranca.md) (seções 3.9 e 3.10)
