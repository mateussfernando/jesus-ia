# 0011 — Primeiro modelo: Claude Haiku 5.5

- Status: aceita
- Data: 08/10/2026
- Substitui: [0010](0010-primeiro-modelo-deepseek-via-deepinfra.md)

## Contexto

A decisão 0010 escolheu o DeepSeek V4.1-Flash na DeepInfra para ter privacidade (dados fora da China). Ao conferir o preço, a DeepInfra saiu mais cara do que o DeepSeek direto, sobretudo na entrada em cache (US$ 0,06 contra 0,003 por milhão de tokens). O dono do projeto pediu outras opções com privacidade e preço baixo.

Comparação para o uso típico estimado (50 respostas por dia, ~20 mil tokens de entrada por resposta, 70% em cache, mil de saída; ~21 milhões de tokens em cache, 9 milhões sem cache e 1,5 milhão de saída por mês):

| Opção | Custo por mês | Dados |
|---|---|---|
| DeepSeek direto (fora do pico) | ~US$ 2,30 | China; os termos permitem usar para treino |
| **Claude Haiku 5.5** | **~US$ 2** | EUA; dados retidos nunca usados para treino sem permissão expressa |
| DeepSeek na Fireworks | ~US$ 3 | EUA; retenção zero por padrão para modelos abertos |
| DeepSeek na DeepInfra (flex / padrão) | ~US$ 4,60 / 5,80 | EUA; apaga após a inferência, pode guardar por um período para depuração |

Preços do Claude Haiku 5.5 conferidos na página oficial em 08/10/2026 (platform.claude.com/docs/en/about-claude/pricing), por milhão de tokens, para pedidos de até 100 mil tokens: entrada US$ 0,10; gravação no cache de 5 min US$ 0,125; leitura do cache US$ 0,01; saída US$ 0,50. **Pedidos acima de 100 mil tokens pagam 5 vezes mais** (0,50 / 0,625 / 0,05 / 2,50). Janela de contexto de 1 milhão de tokens. A documentação de retenção da API diz que os dados retidos "nunca são usados para treinar modelos sem a sua permissão expressa".

## Decisão

- **Cérebro:** Claude Haiku 5.5 (`claude-haiku-5-5`), escolha do dono do projeto entre Fireworks (DeepSeek), Claude Haiku 5.5, os dois, ou manter a DeepInfra.
- Integração pelo AI SDK, com o provedor da Anthropic (decisão 0001: o Jesus continua multi-modelo; o DeepSeek em host com privacidade fica como alternativa configurável).
- O **limite automático de contexto** considera o degrau de preço: para o Haiku 5.5, o alvo de compactação fica abaixo de 100 mil tokens de entrada, mesmo com janela de 1 milhão. O registro de modelos guarda preços por faixa de tamanho de pedido.
- Usar o cache de prompt da Anthropic (prefixo estável: prompt de sistema e ferramentas primeiro).
- **Porteiro:** o modelo continua em aberto até a fase 2. O DeepSeek segue descartado para esse papel (decisão 0010).

## Consequências

- Compra no console da Anthropic, em dólar, com cartão internacional (IOF de 3,5%).
- O raciocínio do Haiku 5.5 vem ligado por padrão (esforço padrão `medium`); os tokens de raciocínio contam como saída. Ajustar o esforço por papel na fase 1, medindo o custo real.
- Recusas por segurança no Haiku 5.5 não têm troca automática de modelo no servidor: o Jesus trata a parada por recusa e avisa o usuário.
- Trocar de modelo nunca muda as regras (seção 9.6); ao trocar, rodar a coleção de ataques.

## Detalhes

[09-modelos.md](../09-modelos.md) · [03-seguranca.md](../03-seguranca.md) (seções 3.5 e 3.9) · [10-roadmap.md](../10-roadmap.md) (seção 10.3)
