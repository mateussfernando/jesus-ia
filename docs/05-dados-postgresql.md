# Parte 5 — Dados: PostgreSQL local

> [Índice da documentação](README.md) · Parte 5 de 10 · as seções seguem a numeração 5.x

## 5.1 Por que PostgreSQL (e o que muda por ser local)

- Robusto e transacional, com **busca semântica** (pgvector), **busca textual em português** (configuração `portuguese` do `tsvector`) e JSON, tudo num banco só.
- Local e de um usuário só: sem servidor na nuvem e sem porta aberta para a rede.
- "Ele saberá tudo de mim": por isso o banco é tratado como um cofre (seções 5.3 e 5.4).

## 5.2 Como rodar

### No desenvolvimento

- **Docker**, o jeito mais simples: imagem `pgvector/pgvector:pg18`, que já vem com o pgvector. Também funciona nas sessões do Claude Code na nuvem.
- Ou PostgreSQL 18 nativo para Windows + pgvector compilado.
- Testes automatizados podem usar o **PGlite** (PostgreSQL em WebAssembly, com pgvector via `@electric-sql/pglite-pgvector`) para subir um banco em memória rapidamente ([PGlite](https://pglite.dev/extensions/)).

### No app instalado (opção recomendada: PostgreSQL embutido)

O Jesus traz os binários do PostgreSQL e cuida dele sozinho:

1. **Na primeira execução:** `initdb` em `%LOCALAPPDATA%\Jesus\pgdata`, com autenticação `scram-sha-256` e senha aleatória (32 bytes) guardada no cofre.
2. **Ao abrir o Jesus:** sobe o `postgres` como processo filho, escutando **só em `127.0.0.1`** numa porta livre. Ao fechar, desliga de forma limpa (`pg_ctl stop -m fast`).
3. **Binários:** o pacote `@embedded-postgres/windows-x64` (binários do projeto zonky, licença Apache-2.0) ou os binários oficiais em zip.
   - **Atenção:** esses binários são PostgreSQL "puro". O **pgvector precisa ser compilado para Windows** (o README do pgvector traz o passo com `nmake /F Makefile.win`) e empacotado junto (`vector.dll` + arquivos de extensão).
4. **Onde ficam:** os binários vão em `extraResources` (fora do `asar`) e os dados na pasta do usuário.

### Comparação das opções

| Opção | Prós | Contras |
|---|---|---|
| **PostgreSQL embutido (recomendado)** | PostgreSQL de verdade; vários processos podem conectar; ferramentas padrão (`pg_dump`) | empacotar binários + pgvector; gerenciar o processo |
| PostgreSQL instalado à parte | simples para você (instalador oficial) | o app depende de instalação manual; serviço do Windows rodando sempre |
| PGlite (WASM) | nenhuma instalação; pgvector disponível | ainda **alfa**; **uma conexão só**; mais lento; melhor para testes |
| Docker | igual ao ambiente de desenvolvimento | exige o Docker Desktop sempre ligado; pesado para um app pessoal |

## 5.3 Configuração segura

- `listen_addresses = '127.0.0.1'` (nunca `*`), numa porta aleatória.
- `pg_hba.conf`: só `host … 127.0.0.1/32 scram-sha-256` (e `::1/128`); nunca `trust`.
- `password_encryption = scram-sha-256`.
- Pasta de dados com permissão NTFS só para o seu usuário.
- **Papéis (roles):**
  - `jesus_owner`: dono do esquema, usado **só** nas migrações.
  - `jesus_app`: leitura e escrita nas tabelas de uso; **sem** `UPDATE`, `DELETE` ou `TRUNCATE` na auditoria; sem criar extensões ou papéis.
  - `jesus_config`: usado só pelo processo principal (interface) para gravar regras e configurações. O Executor não usa esse papel.
- `log_statement = 'none'`, para não gravar dados pessoais nos logs do PostgreSQL.
- O modelo de IA **nunca** escreve SQL; ele só usa ferramentas estruturadas.

## 5.4 Criptografia e backups

- **Disco:** ligue a criptografia do dispositivo/BitLocker do Windows (protege contra roubo do PC ou do disco).
- **Campos sensíveis** (documentos pessoais, saúde, finanças, anotações marcadas como privadas): criptografados pela aplicação com AES-256-GCM antes de gravar, com a chave no cofre. A desvantagem é que não dá para buscar dentro deles no SQL, então isso vale só para os campos que precisam.
- **Por que não usar `pgcrypto` com a chave na consulta?** A chave passaria no texto das consultas e poderia aparecer em logs.
- **Backups:** `pg_dump` diário, criptografado (ex.: com `age`) antes de salvar numa pasta que você escolher. Pode ser um HD externo ou uma nuvem sua, porque o arquivo já sai criptografado. Teste a restauração uma vez por mês.

## 5.5 Esquema (rascunho comentado)

```sql
-- Extensões
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (busca semântica)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- busca aproximada por trechos
-- A busca textual em português usa a configuração 'portuguese', que já vem no PostgreSQL.

-- 1) Sessões e mensagens ------------------------------------------------------
CREATE TABLE sessoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         text,
  modo           text NOT NULL DEFAULT 'automatico'
                 CHECK (modo IN ('somente_leitura','perguntar','planejar','automatico')),
  sessao_pai_id  uuid REFERENCES sessoes(id),           -- ramificação (fork)
  criada_em      timestamptz NOT NULL DEFAULT now(),
  encerrada_em   timestamptz
);

CREATE TABLE mensagens (
  id          bigserial PRIMARY KEY,
  sessao_id   uuid NOT NULL REFERENCES sessoes(id) ON DELETE CASCADE,
  papel       text NOT NULL CHECK (papel IN ('usuario','assistente','ferramenta','sistema')),
  origem      text NOT NULL CHECK (origem IN ('voz','texto','local','externo','sistema')),
  confiavel   boolean NOT NULL,                          -- false para conteúdo externo
  conteudo    jsonb NOT NULL,                            -- partes: texto, chamadas, resultados
  tokens      integer,
  criada_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensagens_sessao_idx ON mensagens (sessao_id, id);

-- 2) Tarefas: unidade de contaminação e de orçamento --------------------------
CREATE TABLE tarefas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id      uuid NOT NULL REFERENCES sessoes(id) ON DELETE CASCADE,
  pedido         text NOT NULL,                          -- pedido literal do usuário
  contaminacao   text NOT NULL DEFAULT 'limpa'
                 CHECK (contaminacao IN ('limpa','contaminada','suspeita')),
  custo_usd      numeric(10,4) NOT NULL DEFAULT 0,
  passos         integer NOT NULL DEFAULT 0,
  iniciada_em    timestamptz NOT NULL DEFAULT now(),
  concluida_em   timestamptz
);

-- 3) Chamadas de ferramenta e decisões do Porteiro ----------------------------
CREATE TABLE chamadas_ferramenta (
  id                uuid PRIMARY KEY,                    -- id da chamada (toolCallId)
  tarefa_id         uuid NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  ferramenta        text NOT NULL,
  parametros        jsonb NOT NULL,                      -- já com segredos mascarados
  origem_parametros jsonb,                               -- de onde veio cada parâmetro
  decisao           text NOT NULL CHECK (decisao IN ('permitida','perguntada','negada')),
  camada            text NOT NULL,                       -- regra | faixa_auto | classificador | contexto
  regra             text,                                -- regra que casou, se houver
  veredito          jsonb,                               -- saída do classificador
  confirmacao       jsonb,                               -- quem, como e quando confirmou
  resultado_resumo  text,
  erro              text,
  criada_em         timestamptz NOT NULL DEFAULT now()
);

-- 4) Auditoria: só acréscimo, encadeada por hash ------------------------------
CREATE TABLE auditoria (
  id             bigserial PRIMARY KEY,
  momento        timestamptz NOT NULL DEFAULT now(),
  evento         text NOT NULL,                          -- ex.: 'ferramenta.executada', 'modo.alterado'
  dados          jsonb NOT NULL,
  hash_anterior  bytea,
  hash           bytea NOT NULL                          -- sha256(hash_anterior || dados canônicos)
);
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM jesus_app;

CREATE FUNCTION auditoria_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a auditoria é somente de acréscimo';
END $$;

CREATE TRIGGER auditoria_sem_alterar
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_imutavel();
CREATE TRIGGER auditoria_sem_truncar
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_imutavel();

-- 5) Memória de longo prazo ---------------------------------------------------
CREATE TABLE memorias (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo              text NOT NULL
                    CHECK (tipo IN ('fato','preferencia','pessoa','projeto','rotina','evento')),
  titulo            text NOT NULL,                       -- rótulo curto, nunca sensível
  conteudo          text,                                -- NULL quando a memória é sensível
  conteudo_cifrado  bytea,                               -- AES-256-GCM quando sensível (seção 5.4)
  origem            text NOT NULL CHECK (origem IN ('usuario_disse','inferido','externo')),
  fonte_ref         text,                                -- ex.: 'sessao:…', 'email:…'
  confianca         real NOT NULL DEFAULT 0.5,
  status            text NOT NULL DEFAULT 'ativa' CHECK (status IN ('pendente','ativa','arquivada')),
  sensivel          boolean NOT NULL DEFAULT false,
  embedding         vector(1024),                        -- ajuste à dimensão do modelo de embedding
  tsv               tsvector GENERATED ALWAYS AS
                    (to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))) STORED,
  criada_em         timestamptz NOT NULL DEFAULT now(),
  usada_em          timestamptz,
  expira_em         timestamptz,
  CHECK (NOT sensivel OR conteudo IS NULL)               -- sensível nunca fica em texto puro
);
CREATE INDEX memorias_embedding_idx ON memorias USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memorias_tsv_idx       ON memorias USING gin (tsv);

-- 6) Pessoas (contatos aprovados como destinatários) --------------------------
CREATE TABLE pessoas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                 text NOT NULL,
  emails               text[] NOT NULL DEFAULT '{}',
  aprovada_para_envio  boolean NOT NULL DEFAULT false,   -- usado pelo controle de saída (3.4.6)
  notas                text,
  criada_em            timestamptz NOT NULL DEFAULT now()
);

-- 7) Contas conectadas (SEM tokens: eles ficam no cofre do Windows) -----------
CREATE TABLE conexoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provedor      text NOT NULL,                           -- google | github | microsoft | mcp:<nome>
  conta         text NOT NULL,                           -- e-mail ou login exibido
  escopos       text[] NOT NULL,
  ref_cofre     text NOT NULL,                           -- chave para achar o token no cofre
  conectada_em  timestamptz NOT NULL DEFAULT now(),
  revogada_em   timestamptz
);

-- 8) Checkpoints de arquivos --------------------------------------------------
CREATE TABLE checkpoints (
  id              bigserial PRIMARY KEY,
  chamada_id      uuid REFERENCES chamadas_ferramenta(id) ON DELETE SET NULL,
  caminho         text NOT NULL,
  conteudo_antes  bytea,                                 -- ou referência a um arquivo na pasta de checkpoints
  hash_antes      bytea,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

-- 9) Rotinas agendadas --------------------------------------------------------
CREATE TABLE rotinas (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome    text NOT NULL,
  quando  text NOT NULL,                                 -- expressão cron
  pedido  text NOT NULL,                                 -- o que fazer, como se você tivesse pedido
  modo    text NOT NULL DEFAULT 'somente_leitura',       -- sem humano presente: nunca executa nível médio ou alto
  ativa   boolean NOT NULL DEFAULT true
);

-- 10) Uso e custo dos modelos -------------------------------------------------
CREATE TABLE uso_modelos (
  id              bigserial PRIMARY KEY,
  tarefa_id       uuid REFERENCES tarefas(id) ON DELETE SET NULL,
  provedor        text NOT NULL,
  modelo          text NOT NULL,
  papel           text NOT NULL,                         -- cerebro | porteiro | rapido | leitor | visao | embedding
  tokens_entrada  integer,
  tokens_saida    integer,
  custo_usd       numeric(10,6),
  momento         timestamptz NOT NULL DEFAULT now()
);

-- 11) Regras do usuário (versionadas; gravadas só pelo papel jesus_config) ----
CREATE TABLE regras_usuario (
  versao        integer PRIMARY KEY,
  conteudo      jsonb NOT NULL,                          -- deny/ask/allow do nível usuário
  alterada_em   timestamptz NOT NULL DEFAULT now(),
  alterada_por  text NOT NULL DEFAULT 'interface' CHECK (alterada_por = 'interface')
);
```

Notas:

- O hash da auditoria é calculado pelo Executor, que é o único que escreve nela; isso evita disputa entre processos (se precisar, use um *advisory lock*).
- O `CHECK (alterada_por = 'interface')` documenta a regra, mas a proteção de verdade são os privilégios: só o papel `jesus_config` tem `INSERT` em `regras_usuario`.

## 5.6 Memória: como o Jesus lembra

- **Índice curto**, como o `MEMORY.md` do Claude Code (que carrega até 200 linhas ou 25 KB): um resumo gerado a partir das memórias mais importantes, carregado em toda sessão.
- **Busca híbrida** quando ele precisa de detalhe: pgvector (proximidade de significado) + busca textual em português + recência, combinando as posições com *Reciprocal Rank Fusion*:

```sql
-- $1 = embedding da pergunta; $2 = texto da pergunta
WITH semantica AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> $1) AS posicao
  FROM memorias
  WHERE status = 'ativa' AND embedding IS NOT NULL
  ORDER BY embedding <=> $1
  LIMIT 20
), textual AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank(tsv, q) DESC) AS posicao
  FROM memorias, plainto_tsquery('portuguese', $2) AS q
  WHERE status = 'ativa' AND tsv @@ q
  ORDER BY ts_rank(tsv, q) DESC
  LIMIT 20
)
SELECT m.id, m.tipo, m.titulo, m.conteudo, m.origem,
       COALESCE(1.0 / (60 + s.posicao), 0) + COALESCE(1.0 / (60 + t.posicao), 0) AS pontuacao
FROM memorias m
LEFT JOIN semantica s ON s.id = m.id
LEFT JOIN textual  t ON t.id = m.id
WHERE s.id IS NOT NULL OR t.id IS NOT NULL
ORDER BY pontuacao DESC
LIMIT 8;
```

- Com filtros (`WHERE status = 'ativa'`), ative a varredura iterativa do pgvector 0.8 (`SET hnsw.iterative_scan = relaxed_order`) para não perder resultados.
- **O que vira memória:**
  - fatos que você disse de forma explícita ("meu dentista é o Dr. X") → `usuario_disse`, ativa;
  - padrões inferidos → `inferido`, pendente até você revisar;
  - coisas lidas em e-mails ou páginas → `externo`, só como fato observado, **nunca** como instrução.
- **Compactação → memória:** ao resumir uma conversa longa, o Jesus propõe memórias novas (que aparecem como "estrelas novas" no holograma).

## 5.7 Retenção, esquecimento e exportação

| Dado | Retenção padrão (ajustável) |
|---|---|
| Mensagens e resultados de ferramentas | 90 dias (depois, só o resumo) |
| Auditoria | 1 ano (exportável) |
| Memórias | até você apagar; `expira_em` para coisas temporárias |
| Checkpoints | 30 dias |

- "Esquecer X" apaga a memória e as mensagens relacionadas; um `VACUUM` periódico limpa o espaço; backups antigos são rotacionados.
- "Exportar tudo": JSON legível + dump criptografado.
