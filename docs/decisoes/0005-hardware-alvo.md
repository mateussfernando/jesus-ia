# 0005 — Alvo de 8 a 16 GB de RAM, sem GPU dedicada

- Status: aceita
- Data: 07/10/2026

## Contexto

O dono do projeto quer que o Jesus funcione em PCs comuns: 8 a 16 GB de RAM e só a placa de vídeo integrada.

## Decisão

- O cérebro e o Porteiro rodam na nuvem, via API. LLM local (Ollama) é opcional.
- Voz local leve: Parakeet v3 (STT, rápido em CPU) e Piper (TTS).
- Embeddings pequenos (locais) ou via API.
- Holograma com modo leve automático (menos partículas, *bloom* em meia resolução).

## Consequências

- Precisa de internet e de uma chave de API para o cérebro.
- Em 8 GB, o orçamento de memória fica apertado; o Docker fica de fora por padrão.
- Whisper em CPU é lento demais; só via nuvem.

## Detalhes

[04-tecnologias.md](../04-tecnologias.md) (seção 4.6) · [07-voz.md](../07-voz.md) · [09-modelos.md](../09-modelos.md)
