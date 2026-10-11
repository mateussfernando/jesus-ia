# 0013 — Interface em Next.js dentro do Electron

- Status: aceita (a exportação estática, sem servidor, foi substituída pela [0016](0016-nextjs-com-servidor-dentro-do-electron.md): o app usa o servidor do Next, sem porta)
- Data: 10/10/2026
- Complementa: [0002](0002-typescript-e-electron.md) (o Electron continua) e [0008](0008-holograma-como-pacote-e-laboratorio.md) (o laboratório sai do Vite)

## Contexto

O dono do projeto pediu que o Jesus seja refeito com React, Next.js e TypeScript. O Next.js é um framework web: sozinho, ele não faz o que o Jesus precisa no Windows (janela mini transparente e sempre no topo, atalho global de segurar para falar, bandeja, cofre do Windows via DPAPI, processos separados para Cérebro, Porteiro e voz). Entre as duas opções apresentadas (Next.js dentro do Electron, ou só Next.js aberto no navegador), o dono escolheu **Next.js dentro do Electron**.

Testes de 10/10/2026 com o Next.js 16.4:

- A exportação estática (`output: 'export'`) funciona com o App Router e componentes de cliente.
- O HTML exportado traz **scripts inline** (o carregamento do App Router: `self.__next_f.push(...)`). A CSP da seção 3.12 (`script-src 'self'`, sem `unsafe-inline`) bloquearia esses scripts. *Nonces* não servem, porque exigem um servidor gerando a página a cada pedido.
- O Next 16 compila com o Turbopack por padrão; os pacotes do projeto (`@jesus/*`, que exportam o código-fonte TypeScript) entram por `transpilePackages`.

## Decisão

- A interface do Jesus é um app **Next.js (App Router) + React + TypeScript**, no workspace `apps/ui` (`@jesus/ui`). O Electron (`apps/desktop`, fase 1) continua sendo o app de desktop: processo principal, janelas, atalhos, bandeja, cofre e os `utilityProcess` do Cérebro, do Porteiro + Executor e da voz.
- **Exportação estática, sem servidor.** O build do Next gera arquivos (`apps/ui/out`) que o Electron carrega pelo protocolo próprio `app://` (nunca `file://`). Não existem rotas de API, *server actions*, *middleware* nem servidor HTTP do Next rodando no PC: tudo o que a interface pede ao sistema passa por IPC, pela ponte mínima do `contextBridge` (seção 3.12). Assim nenhuma porta local fica aberta para outros programas ou sites.
- **CSP rígida com hashes.** Depois do `next build`, um script calcula o SHA-256 de cada script inline de cada página e grava a política na própria página (`<meta http-equiv="Content-Security-Policy">`), com `script-src 'self' 'sha256-…'`. A política continua sem `unsafe-inline` e sem `unsafe-eval` para scripts. O mesmo cálculo serve ao cabeçalho que o protocolo `app://` do Electron vai mandar.
- **Componentes de cliente.** As páginas são componentes de cliente (`'use client'`); o holograma (React Three Fiber) entra com carregamento dinâmico sem pré-renderização (`ssr: false`), porque WebGL só existe no navegador.
- O **laboratório do holograma** deixa de ser um app Vite (`apps/hologram-lab`) e vira a aba **Cenários** (`/cenarios`) do `apps/ui`, como o dono pediu (seção 8.8). Os cenários, a simulação de contexto e a compactação automática mudam de lugar sem mudar de lógica, com os mesmos testes.
- Em desenvolvimento, o Electron pode carregar o `next dev` (`http://localhost`), só na máquina de quem desenvolve; o app instalado usa sempre a exportação.
- Os pacotes de lógica pura (`@jesus/hologram`, `@jesus/models`, `@jesus/core`) não mudam: não dependem de framework.

## Consequências

- O dono continua com um app de desktop instalável (`.exe`), agora com a interface em Next.js.
- Sem servidor HTTP local, o Next.js não acrescenta superfície de ataque de rede. A segurança da interface continua a da seção 3.12 (isolamento de contexto, sandbox, CSP, IPC validado).
- O build da interface ganha um passo a mais (hashes da CSP). Se uma versão nova do Next mudar a forma dos scripts inline, o teste do passo de CSP acusa.
- Recursos do Next que dependem de servidor (imagens otimizadas, ISR, *route handlers*) ficam de fora. Para um app que conversa com o sistema por IPC, eles não fazem falta.
- O `npm run dev:hologram` passa a abrir a aba Cenários do `apps/ui` (mesma porta, 5173). O artefato do CI passa a se chamar `interface`.

## Detalhes

[04-tecnologias.md](../04-tecnologias.md) (seções 4.3, 4.4, 4.7 e 4.9) · [03-seguranca.md](../03-seguranca.md) (seção 3.12) · [08-holograma.md](../08-holograma.md) (seção 8.8)
