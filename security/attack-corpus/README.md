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

- **`link-targets.json`** — o caminho a que um link leva, conferido antes de o Executor seguir o link ([decisão 0026](../../docs/decisoes/0026-ferramentas-de-leitura-e-pastas-liberadas.md)): o contexto (lugares e pastas liberadas) no topo; cada caso tem `id`, `target` (o alvo do link junto com o resto do caminho pedido), `expect` e, com `deny`, `reason` (como em `read-paths.json`; a negação é sempre pelo caminho real).

- **`release-folders.json`** — que pastas o dono pode liberar ([decisão 0026](../../docs/decisoes/0026-ferramentas-de-leitura-e-pastas-liberadas.md)): o contexto (pasta do usuário, pastas pessoais, do sistema e do Jesus) no topo; cada caso tem `id`, `folder` (o caminho real escolhido no diálogo), `expect` e, com `deny`, `reason` (`path:<problema>`, `root`, `too_broad`, `personal`, `system`, `app_data`, `jesus` ou `sensitive:<tipo>`).

Os caminhos usam `\\` (barra invertida escapada no JSON). Caracteres invisíveis entram como `\uXXXX`, nunca colados.
