# 0027 — Conversas guardadas sem prazo

- Status: aceita
- Data: 21/10/2026

## Contexto

A [decisão 0007](0007-padroes-iniciais.md) fixou que as conversas ficariam guardadas por 90 dias e que, depois disso, sobraria só o resumo. A tabela de retenção ([seção 5.7](../05-dados-postgresql.md)) aplicava esse prazo às mensagens e aos resultados de ferramentas.

Em 21/10/2026, o dono do projeto pediu (palavras dele): "não precisa ser por só 90 dias, pode ficar lá sempre".

Hoje nada é guardado em disco: na fase 1, a conversa fica só na memória do Cérebro e some ao fechar o app ([decisão 0024](0024-laco-da-conversa-no-cerebro.md)). O prazo passaria a valer com o banco, na fase 4.

## Decisão

- **Mensagens e resultados de ferramentas ficam sem prazo.** Nada é apagado sozinho, e a conversa fica inteira: não vira só o resumo depois de um tempo.
- **Apagar continua com o dono.** "Esquecer X" apaga de verdade, e o que foi apagado sai dos backups seguintes ([seção 3.9](../03-seguranca.md)). A fase 4 também deixa apagar uma conversa, ou todas.
- **Continua ajustável** (seção 3.9): muda só o padrão, de 90 dias para sem prazo.
- **Os outros prazos da tabela não mudam:** auditoria por 1 ano, checkpoints por 30 dias e memórias até o dono apagar.
- **Guardar não muda o que vai para a IA:** continua indo ao modelo só o necessário para a tarefa (seção 3.9).

## Consequências

- **Mais dado pessoal acumulado no PC.** O banco vira um alvo maior se o PC for roubado ou invadido. Valem as proteções já previstas: banco só local, com senha aleatória no cofre; campos sensíveis cifrados com AES-256-GCM ([decisão 0015](0015-senha-local-com-bcrypt-e-dados-cifrados.md)); backups cifrados; e a recomendação de ligar o BitLocker. Nada disso protege por completo contra um programa rodando como o dono (o DPAPI não protege), o que dá mais peso à pergunta em aberto 3 do [roadmap](../10-roadmap.md) (seção 10.3): derivar a chave dos dados também da senha local.
- **O que o Jesus leu também fica.** Os resultados de ferramentas guardam trechos de arquivos (e, nas fases seguintes, de e-mails e páginas), com os segredos já mascarados.
- **O banco cresce sem parar.** A fase 4 deve mostrar o espaço usado ao lado do botão de apagar conversas.
- **Rascunhos afetados:** em `algoritmo-memoria.md`, a purga das mensagens aos 90 dias deixa de existir (elas só saem quando o dono apaga); a validade de 90 dias do fato observado (`observed`) é outra regra e segue como proposta. Em `algoritmo-subagentes.md`, a transcrição de cada subagente segue a regra das conversas.

## Detalhes

[05-dados-postgresql.md](../05-dados-postgresql.md) (seção 5.7) · [03-seguranca.md](../03-seguranca.md) (seção 3.9) · [10-roadmap.md](../10-roadmap.md) (seção 10.3) · [decisão 0007](0007-padroes-iniciais.md)
