# 0012 — Conversa por voz antes da execução

- Status: aceita
- Data: 08/10/2026

## Contexto

No roadmap original, a voz vinha só na fase 6, depois do Porteiro, do terminal, do banco e do classificador. O dono do projeto quer conversar com o Jesus por voz cedo, para fazer perguntas e ouvir respostas, antes de ele executar coisas complexas.

## Decisão

- Nova **fase 1.5 — Conversa por voz**, logo depois da fase 1 (chat por texto). Os números das outras fases não mudam.
- Escopo: segurar uma tecla para falar, transcrição local (STT), resposta falada (TTS) e o holograma ouvindo e falando. **Só perguntas e respostas**, com as mesmas ferramentas só de leitura da fase 1.
- Fica para a fase 6: "Ei, Jesus" (palavra de ativação), interrupção natural, voz para confirmar ações e o ajuste fino de latência.

## Consequências

- Risco baixo: sem execução, a voz não abre caminho novo para ações; a regra de que ação de alto risco nunca se confirma só por voz (seção 3.4.7) continua valendo quando as ações chegarem.
- O módulo de voz (sherpa-onnx) tem binário nativo: entra pelo processo de aprovação de scripts (decisão 0009) e é testado no PC do dono, porque a nuvem não tem microfone.
- A fase 1.5 adia um pouco o Porteiro; a ordem "Porteiro antes do terminal e das contas" continua igual.
