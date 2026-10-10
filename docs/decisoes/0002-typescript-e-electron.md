# 0002 — TypeScript + Electron

- Status: aceita (o gerenciador de pacotes foi substituído pela [0009](0009-npm-em-vez-de-pnpm.md); a interface dentro do Electron é Next.js, pela [0013](0013-interface-em-nextjs-dentro-do-electron.md))
- Data: 07/10/2026

## Contexto

O dono do projeto queria Python ou TypeScript. A interface e o holograma exigem JS/TS de qualquer forma, o app precisa virar um `.exe` instalável no Windows, e os SDKs de IA, MCP, Google e GitHub são de primeira linha em TypeScript. O ponto fraco do TypeScript é a voz local, coberta pelo sherpa-onnx.

## Decisão

TypeScript (modo `strict`) em todo o projeto, com Electron como app de desktop (electron-builder, instalador NSIS) e monorepo com pnpm workspaces (gerenciador trocado para o npm na [decisão 0009](0009-npm-em-vez-de-pnpm.md)). Um processo auxiliar em Python para voz fica como plano B, caso as bibliotecas de voz em Node não atendam.

## Consequências

- Uma linguagem só para o dono do projeto e para os agentes de IA que vão programar.
- Electron é mais pesado que Tauri (~100–150 MB), aceitável para o alvo de hardware.
- O Electron exige seguir a lista de segurança dele (isolamento de contexto, sandbox, CSP).

## Detalhes

[04-tecnologias.md](../04-tecnologias.md) (seções 4.2 a 4.4) · [03-seguranca.md](../03-seguranca.md) (seção 3.12)
