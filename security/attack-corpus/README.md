# Coleção de ataques

Casos que o Porteiro (`packages/gate`) tem de decidir sempre do mesmo jeito. Ela só cresce: um ataque novo, um falso positivo corrigido ou uma regra nova entra aqui junto com a mudança ([seção 3.17](../../docs/03-seguranca.md)).

Rodar: `npm run attack-corpus` (também roda no `npm test` e no CI).

## Arquivos

- **`read-paths.json`** — leitura de arquivos na fase 1 ([decisão 0021](../../docs/decisoes/0021-porteiro-minimo-para-leituras.md)). O contexto fica no topo do arquivo: a pasta do usuário, as pastas de dados, as do Jesus e as pastas liberadas. Cada caso tem:
  - `id`: nome curto e único;
  - `requested`: o caminho que o modelo pediu (texto cru, como chegaria);
  - `real` (opcional): o caminho real que o Executor veria no disco, depois de links e junções (sem ele, o real é o próprio pedido normalizado);
  - `kind` (`file`, `directory` ou `other`; padrão `file`) e `links` (número de nomes; padrão 1): o que o disco mostraria;
  - `expected` (`file` ou `directory`; padrão `file`): o que a ferramenta pediu;
  - `expect`: `allow` ou `deny`; com `deny`, `reason` (`path:<problema>`, `jesus`, `sensitive:<tipo>`, `outside`, `kind` ou `hardlink`) e, se importar, `which` (`requested` ou `real`);
  - `note`: por que o caso existe.

Os caminhos usam `\\` (barra invertida escapada no JSON). Caracteres invisíveis entram como `\uXXXX`, nunca colados.
