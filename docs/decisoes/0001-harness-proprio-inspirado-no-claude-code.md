# 0001 — Harness próprio, inspirado no Claude Code

- Status: aceita
- Data: 07/10/2026

## Contexto

O Jesus deve funcionar de forma parecida com o Claude Code (loop agêntico, ferramentas, permissões, hooks, memória, subagentes), mas com **qualquer** modelo de IA. O Claude Agent SDK entrega exatamente o harness do Claude Code como biblioteca, porém roda o binário do Claude Code com modelos Claude, exige chave de API para produtos de terceiros e tem regras de marca.

## Decisão

Construir um harness próprio em TypeScript sobre uma biblioteca multi-modelo (Vercel AI SDK), replicando os conceitos do Claude Code. O Claude Agent SDK e o OpenCode podem entrar depois como "motores de programação" opcionais, sempre atrás do Porteiro.

## Consequências

- Liberdade para trocar de modelo e para adicionar voz, holograma e contas pessoais.
- Mais código para escrever e manter (loop, compactação, subagentes, ganchos).
- O mapa conceito a conceito serve de guia e evita reinventar decisões já testadas.

## Detalhes

[01-visao.md](../01-visao.md) (seção 1.2) · [02-arquitetura.md](../02-arquitetura.md) (seção 2.1) · [04-tecnologias.md](../04-tecnologias.md) (seção 4.4)
