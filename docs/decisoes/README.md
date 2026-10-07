# Registro de decisões (ADR)

Cada decisão importante do projeto fica num arquivo próprio, curto, com contexto, decisão e consequências. Decisões não são apagadas: quando mudam, criamos uma nova que **substitui** a anterior e marcamos a antiga como "substituída".

| Nº | Decisão | Status |
|---|---|---|
| [0001](0001-harness-proprio-inspirado-no-claude-code.md) | Harness próprio, inspirado no Claude Code | aceita |
| [0002](0002-typescript-e-electron.md) | TypeScript + Electron | aceita |
| [0003](0003-porteiro-fora-da-ia.md) | Porteiro de segurança fora da IA | aceita |
| [0004](0004-postgresql-local.md) | PostgreSQL local embutido + pgvector | aceita |
| [0005](0005-hardware-alvo.md) | Alvo de 8 a 16 GB de RAM, sem GPU dedicada | aceita |
| [0006](0006-comandos-direto-no-windows.md) | Comandos direto no Windows, WSL2 opcional | aceita |
| [0007](0007-padroes-iniciais.md) | Padrões iniciais (nomes, uso pessoal, contas, retenção, voz) | aceita |
| [0008](0008-holograma-como-pacote-e-laboratorio.md) | Holograma como pacote próprio, com laboratório web | aceita |

## Modelo

```markdown
# NNNN — Título curto

- Status: proposta | aceita | substituída por NNNN
- Data: DD/MM/AAAA

## Contexto
O problema e as restrições.

## Decisão
O que foi decidido.

## Consequências
O que fica mais fácil, o que fica mais difícil, riscos.

## Detalhes
Links para as seções da documentação.
```
