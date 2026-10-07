# Parte 9 — Modelos de IA

> [Índice da documentação](README.md) · Parte 9 de 10 · as seções seguem a numeração 9.x

## 9.1 Camada de provedores

- Você cola as chaves na interface, e elas vão para o cofre.
- **Provedores:** Anthropic, OpenAI, Google, Mistral, Groq, DeepSeek, xAI, OpenRouter (uma chave para centenas de modelos) e modelos locais (Ollama, LM Studio) via API compatível com a da OpenAI.
- Tudo passa pelo AI SDK, que padroniza mensagens, ferramentas e streaming.
- Prefira conexão **direta** com cada provedor, ou o OpenRouter se quiser uma chave só, mantendo o princípio de local primeiro.

## 9.2 Papéis

| Papel | O que faz | Requisitos |
|---|---|---|
| **Cérebro** | conversa, planeja, usa ferramentas | o melhor *tool calling* disponível; contexto grande |
| **Porteiro** | classificador de risco | confiável e consistente; temperatura 0; JSON |
| **Rápido** | respostas curtas, roteamento, títulos | barato e rápido |
| **Leitor (quarentena)** | extrai informação de e-mails e páginas | sem ferramentas; pode ser barato |
| **Visão** | entender imagens e a tela | multimodal |
| **Embeddings** | memória | multilíngue, de preferência local |
| **Sonda de injeção** | detectar injeção nos resultados | pequeno e rápido |

Cada papel pode usar um provedor diferente.

## 9.3 Registro de capacidades

Para cada modelo, o Jesus guarda: provedor, nome, janela de contexto, se usa ferramentas, se entende imagem, preço por milhão de tokens (entrada e saída), se tem cache de prompt e a latência média medida. O tamanho do contexto alimenta o contorno do holograma; o preço alimenta o anel de gasto.

## 9.4 Custos

- Orçamento por dia e por tarefa; alerta em 80%; parada em 100%.
- Usar cache de prompt quando o provedor oferece (prompt de sistema e ferramentas fixos no começo da conversa).
- Compactar antes de estourar; usar um leitor em quarentena barato para textos longos.

## 9.5 Modelos locais

- **Ollama** (ou LM Studio) traz privacidade e modo offline. Funciona bem para embeddings, leitor em quarentena, sonda de injeção e tarefas com dados sensíveis.
- **Limitação:** modelos locais pequenos têm *tool calling* mais fraco. As regras de segurança continuam iguais.

## 9.6 Regra de ouro

Trocar de modelo **nunca** muda as regras. Ao trocar o modelo do cérebro ou do Porteiro, rode a coleção de ataques (seção [3.17](03-seguranca.md)).
