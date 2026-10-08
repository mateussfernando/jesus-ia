# 0010 — Primeiro modelo: DeepSeek V4.1-Flash hospedado na DeepInfra

- Status: substituída por [0011](0011-primeiro-modelo-claude-haiku.md)
- Data: 08/10/2026

## Contexto

O dono do projeto quer começar pelo DeepSeek, pelo preço baixo. Pesquisa de 08/10/2026 (feita numa sessão na nuvem cujo proxy bloqueia os sites do DeepSeek e da DeepInfra; os números vieram de trechos das páginas oficiais em buscadores e de várias fontes de terceiros, e precisam ser conferidos no painel antes de recarregar):

- **Modelo:** `deepseek-flash` (DeepSeek V4.1-Flash, lançado em 10/09/2026, pesos abertos sob licença MIT), janela de 1 milhão de tokens. Os nomes `deepseek-chat` e `deepseek-reasoner` foram aposentados em 24/07/2026.
- **API direta do DeepSeek:** US$ 0,15 / 0,003 / 0,60 por milhão de tokens (entrada / entrada em cache / saída) fora do pico, o dobro no pico.
- **Privacidade da API direta:** dados guardados na China, termos que permitem usar entradas e saídas para melhorar o serviço, retenção enquanto a conta existir, sem opção documentada de desligar o treino para a API. Há incidentes públicos (banco de dados exposto em 2025; restrições na Itália e na Coreia do Sul). Isso conflita com a seção 3.9, porque o cérebro do Jesus recebe memória pessoal, trechos de e-mails, agenda e arquivos.
- **DeepInfra (EUA):** hospeda o mesmo modelo como `deepseek-ai/DeepSeek-V4.1-Flash`. A documentação diz que o conteúdo das requisições fica só na memória durante a inferência e é apagado em seguida, e que não usa os dados para treinar; a política de privacidade admite guardar entradas e saídas "por um período limitado" para depuração. A página do modelo mostra US$ 0,30 / 0,06 / 1,20 (padrão), 0,24 / 0,048 / 0,96 (flex) e 0,45 / 0,09 / 1,80 (prioridade); agregadores mostram valores menores (ex.: 0,20 / 0,006 / 0,60), então vale o que estiver no painel.
- O Claude Haiku 5.5 custa US$ 0,10 / 0,50 (entrada / saída, pedidos até 100 mil tokens), praticamente o mesmo, e foi a alternativa considerada.

## Decisão

- **Cérebro:** DeepSeek V4.1-Flash **via DeepInfra**, com o provedor `@ai-sdk/deepinfra` do AI SDK. Escolha do dono do projeto entre quatro opções (DeepInfra, DeepSeek direto só para tarefas sem dados pessoais, DeepSeek direto em tudo, Claude Haiku 5.5).
- **API direta do DeepSeek:** não usada por enquanto.
- **Porteiro (classificador de risco):** **não** usa DeepSeek, em nenhum provedor. Avaliações independentes mostram baixa robustez a injeção e a jailbreak, e o modo JSON às vezes devolve resposta vazia (o que, pela invariante 4, viraria confirmação humana, mas deixaria o Porteiro inútil). O modelo do Porteiro fica para a fase 2.
- **Dados sensíveis** (saúde, documentos, finanças): continuam indo só para modelo local por padrão (seção 3.9).
- O ID do modelo e o provedor ficam configuráveis no registro de modelos; trocar de modelo nunca muda as regras (seção 9.6).

## Consequências

- Custo estimado, com 50 respostas por dia de 20 mil tokens de entrada (70% em cache) e mil de saída: cerca de US$ 6 por mês no preço padrão da DeepInfra, contra cerca de US$ 2 no DeepSeek direto fora do pico. A diferença vem quase toda do preço de entrada em cache (US$ 0,06 contra 0,003).
- Compra na DeepInfra, em dólar, com cartão internacional (IOF de 3,5%).
- O `@ai-sdk/deepinfra` é construído sobre o `@ai-sdk/openai-compatible`. Na fase 1, testar com a chave real: (1) se os tokens em cache aparecem no uso (senão o custo fica superestimado); (2) se o raciocínio com várias rodadas de ferramentas funciona sem erro; (3) a janela de contexto real oferecida pela DeepInfra para esse modelo.
- Ao trocar a versão do modelo por baixo do mesmo nome, rodar a coleção de ataques (seção 9.6).

## Detalhes

[09-modelos.md](../09-modelos.md) · [03-seguranca.md](../03-seguranca.md) (seções 3.5 e 3.9) · [10-roadmap.md](../10-roadmap.md) (seção 10.3)
