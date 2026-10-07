# 0003 — Porteiro de segurança fora da IA

- Status: aceita
- Data: 07/10/2026

## Contexto

O Jesus terá as três pernas da "tríade letal": lê conteúdo não confiável (e-mails, sites), tem dados privados (memória, contas) e consegue agir para fora (enviar, convidar, rodar comandos). Nenhuma defesa contra injeção de prompt é perfeita hoje: o próprio classificador do modo automático do Claude Code deixa passar 17% de ações "afobadas" reais, e ataques adaptativos quebram a maioria das defesas publicadas.

## Decisão

A IA só **propõe** ações. Um Porteiro em código decide, em camadas: regras fixas (`deny → ask → allow`), faixa automática para leituras e edições no projeto, classificador de risco "cego ao raciocínio" (como o do Claude Code) e política de contexto (contaminação e Regra dos Dois). O que é externo ou irreversível exige confirmação humana assinada. Um Executor separado, o único que tem os tokens, executa e revalida tudo.

## Consequências

- A segurança não depende do modelo escolhido.
- Mais confirmações para o usuário; o desenho tenta reduzir a fadiga (agrupar o que é seguro, só pedir o necessário).
- O Porteiro precisa existir **antes** de o Jesus ganhar terminal e contas (roadmap, fase 2).

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seções 3.0 e 3.4) · [prompts.md](../prompts.md) (Apêndice B)
