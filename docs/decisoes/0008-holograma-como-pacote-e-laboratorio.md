# 0008 — Holograma como pacote próprio, com laboratório web

- Status: aceita
- Data: 07/10/2026

## Contexto

A fase 0 pede um protótipo web do holograma com dados falsos, antes de existir o app Electron. A estrutura proposta na seção 4.7 colocava o holograma dentro de `apps/desktop/renderer`, que ainda não existe. Além disso, o TypeScript 7.0 (compilador nativo) já saiu, mas o typescript-eslint ainda só aceita versões `< 6.1`.

## Decisão

- O holograma vira o pacote `packages/hologram`: um componente React (`<Hologram snapshot={…} />`) cuja entrada é um **snapshot** validado com Zod. A lógica visual fica em funções puras, testáveis em Linux.
- O protótipo da fase 0 é o app `apps/hologram-lab` (Vite + React + Zustand), com cenários roteirizados. Na fase 1, a janela do Electron usa o mesmo pacote; o laboratório continua útil para ajustar o visual sem o resto do sistema.
- TypeScript fixado em 6.0 até o typescript-eslint suportar a 7.
- pnpm com `minimumReleaseAge` de 3 dias e scripts de instalação bloqueados por padrão (seção 3.14).

## Consequências

- Dá para evoluir e testar o holograma sem Electron, banco ou modelos.
- A interface entre o "sistema" e o holograma é só o snapshot: na fase 1, o processo principal monta esse objeto e envia por IPC.
- Uma dependência a mais para manter (Vite no laboratório; o Electron usará `electron-vite`, também baseado no Vite).

## Detalhes

[08-holograma.md](../08-holograma.md) (seção 8.8) · [04-tecnologias.md](../04-tecnologias.md) (seções 4.7 e 4.9) · [10-roadmap.md](../10-roadmap.md)
