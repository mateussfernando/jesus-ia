# Parte 7 — Voz

> [Índice da documentação](README.md) · Parte 7 de 10 · as seções seguem a numeração 7.x

## 7.1 Pipeline

```text
microfone → cancelamento de eco → [ativação: "Ei, Jesus" ou tecla] → VAD (detecta o fim da fala)
        → STT (transcrição) → cérebro → texto em partes (frase a frase) → TTS → alto-falante
                                                              ↘ amplitude do áudio → holograma
```

- **Captura:** `getUserMedia` com `echoCancellation`, `noiseSuppression` e `autoGainControl` (no renderer) ou captura nativa no processo de voz.
- **Interrupção (*barge-in*):** se você falar enquanto ele fala, ele para na hora.
- **Frase a frase:** o TTS começa assim que a primeira frase fica pronta, então a resposta começa bem antes de o modelo terminar.

## 7.2 Orçamento de latência (alvo)

| Etapa | Alvo |
|---|---|
| Detectar o fim da fala (VAD) | 300–600 ms de silêncio |
| Transcrição local | 150–600 ms |
| Primeira palavra do modelo | 300–1.500 ms (depende do provedor) |
| Primeiro áudio do TTS | 100–300 ms |
| **Total até começar a responder** | **cerca de 1–2,5 s** |

## 7.3 Palavra de ativação

| Opção | Português | Observações |
|---|---|---|
| **Porcupine (Picovoice)** | sim (frase personalizada criada no Console) | detecção no próprio aparelho; plano gratuito para uso pessoal e não comercial; a chave de acesso é validada online; SDK `@picovoice/porcupine-node` ([Picovoice](https://picovoice.ai/docs/quick-start/porcupine-nodejs/)) |
| openWakeWord | foco em inglês; outras línguas via treino da comunidade | Python; código aberto |
| Detecção via STT contínuo | sim | gasta mais CPU; serve de plano B |
| **Tecla de segurar-para-falar** | — | sempre disponível; a opção mais segura |

Use "Ei, Jesus" (duas palavras) e ajuste a sensibilidade.

## 7.4 Transcrição (STT) em português

Benchmark FLEURS em português do projeto Handy ([models.handy.computer](https://models.handy.computer/languages/pt)), medido num Ryzen 4750U (GPU via Vulkan):

| Modelo | Erro (WER) | Velocidade CPU / GPU (× tempo real) | Tamanho | Licença |
|---|---|---|---|---|
| whisper-large-v3 | 3,88% | 0,6× / 2,1× | 1,55 GB | Apache-2.0 |
| **whisper-large-v3-turbo** | 4,17% | 0,8× / 3,4× | 0,83 GB | Apache-2.0 |
| canary-1b-v2 | 4,50% | 6,7× / 13,2× | 1,10 GB | CC-BY-4.0 |
| **parakeet-tdt-0.6b-v3** | 4,96% | 7,5× / 12,5× | 0,72 GB | CC-BY-4.0 |

- **Como ler:** velocidade abaixo de 1× significa mais lento que a própria fala, o que não serve para conversa em CPU.
- **Recomendação:**
  - **Parakeet v3** como padrão: rápido em CPU, com cerca de 5% de erro, rodando via sherpa-onnx ([modelo](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)). Há relatos de erro ao carregar a versão int8 no sherpa-onnx, então teste.
  - **Whisper turbo** se você tiver GPU.
  - Nuvem como opção (ex.: Whisper turbo no Groq, OpenAI ou Deepgram); nesse caso o áudio sai do PC.

## 7.5 Voz do Jesus (TTS)

| Opção | Português | Observações |
|---|---|---|
| **Piper** (local) | pt-BR: "faber" (qualidade média) e "edresson" (baixa) | rápido em CPU; o projeto agora vive em `OHF-Voice/piper1-gpl` (GPL-3.0); vozes em `rhasspy/piper-voices` no Hugging Face |
| **Kokoro** (local) | pt-BR (código de idioma `p`) | 82 milhões de parâmetros; a qualidade fora do inglês varia, então teste antes |
| Nuvem (ElevenLabs, OpenAI, Azure) | sim | mais natural; tem custo; o texto sai do PC |

**Persona sugerida:** voz calma, grave e pausada; falas curtas, com o detalhe na tela.

## 7.6 Modo conversa em tempo real (futuro)

APIs de fala-para-fala (ex.: OpenAI Realtime, Gemini Live) dão a conversa mais natural, mas prendem você a um provedor e o áudio sai do PC. Se usar, as ferramentas chamadas pela sessão em tempo real passam **pelo mesmo Porteiro**.

## 7.7 Regras de segurança da voz

Estão na seção [3.11](03-seguranca.md). Resumo: voz nunca aprova nível alto; "pare" sempre funciona; cuidado com áudio de TV e vídeo.
