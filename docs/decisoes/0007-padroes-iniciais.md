# 0007 — Padrões iniciais

- Status: aceita (a retenção das conversas foi substituída pela [0027](0027-conversas-guardadas-sem-prazo.md): sem prazo)
- Data: 07/10/2026

## Contexto

Antes de começar o desenvolvimento, foram propostos padrões para as decisões menores. O dono do projeto aceitou todos.

## Decisão

- **Identificadores em inglês** (código, banco, nomes de ferramentas); textos de interface e documentação em português.
- **Uso pessoal** por enquanto: cada usuário cria o próprio projeto e Client ID no Google; sem assinatura de código.
- Nome **"Jesus"**; ativação por **"Ei, Jesus"** + tecla de segurar-para-falar.
- Primeiras contas: **Google** (Agenda, Gmail, Contatos) e **GitHub** (GitHub App com *device flow*).
- Conversas guardadas por **90 dias** (depois só o resumo).
- Voz local: **Parakeet** (STT) e **Piper** (TTS).

## Consequências

- Os exemplos em português da documentação (`agenda.criar`, tabela `memorias`) viram nomes em inglês no código (`calendar.create_event`, `memories`).
- Se um dia o Jesus for distribuído, revisar: verificação do Google, assinatura do instalador e licenças (o Piper é GPL-3.0).

## Detalhes

[10-roadmap.md](../10-roadmap.md) (seção 10.3) · [06-integracoes.md](../06-integracoes.md) · [07-voz.md](../07-voz.md)
