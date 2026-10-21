# 0019 — Bloqueio pelos eventos do Windows e ponte do servidor da interface com o principal

- Status: aceita
- Data: 19/10/2026

## Contexto

A senha local ([decisão 0015](0015-senha-local-com-bcrypt-e-dados-cifrados.md), seção [3.20](../03-seguranca.md)) bloqueia o Jesus em quatro situações:

- ao abrir;
- depois do tempo sem uso;
- quando o Windows bloqueia a sessão;
- quando o PC suspende.

O estado de acesso mora no servidor da interface, o utilityProcess `jesus-next` ([decisão 0017](0017-servidor-do-next-num-utilityprocess.md)). Mas quem vê os eventos do sistema é o processo principal (`powerMonitor`), e só ele vê a entrada de verdade do teclado e do mouse.

Até aqui, o "uso" que adiava o bloqueio vinha da própria página, por uma Server Action. Uma página comprometida poderia chamá-la sem parar, e o Jesus nunca bloquearia sozinho.

## Decisão

- **Ponte congelada no `jesus-next`:**
  - Antes de o Next carregar qualquer código do `apps/ui`, o servidor da interface põe num símbolo global (`Symbol.for('jesus.desktop.bridge')`) um objeto congelado e não configurável. Ele traz `onLock`, `onActivity` e `idleMs`.
  - Cada ouvinte só pode ser registrado uma vez.
  - O `apps/ui` (`server/desktop-bridge.ts`) confere a forma do objeto antes de usar. No `next dev`, a ponte não existe, e tudo segue como antes.

- **Mensagens novas na ponte do principal** (Zod estrito, decisão 0017):
  - `lock` (`os_locked` ou `suspend`), com número de sequência;
  - `activity`;
  - de volta, `lock-ack` com o mesmo número.
  - O servidor só confirma depois de aplicar o bloqueio no estado de acesso. Sem quem aplique (o estado ainda não existe), ele também confirma, porque o estado vai começar bloqueado.

- **Eventos do Windows no principal:**
  - `lock-screen` vira `os_locked`;
  - `suspend` e `resume` viram `suspend`. A volta da suspensão bloqueia de novo, caso o aviso de suspensão não tenha chegado a tempo;
  - **segunda barreira:** a cada 15 s, `powerMonitor.getSystemIdleState` diz se a sessão está bloqueada. Isso pega um aviso perdido.

- **Três camadas a cada bloqueio:**
  1. o principal apaga o pote de cookies, e a página perde a sessão na hora;
  2. avisa o servidor da interface;
  3. volta a janela para o início, que leva à tela de entrada. Desde 21/10/2026 (etapa 11), um guarda confere: se em 3 s a janela não passou pela entrada (a navegação se perdeu, visto uma vez no CI do Windows), ela vai direto para lá, com aviso no log e `window.entry_retry` no registro (`src/main/entry-guard.ts`). O início agora mostra a conversa, e o que já estava desenhado não pode ficar na tela.
  - Sem `lock-ack` em 2 s, o principal derruba o servidor da interface, que sobe de novo bloqueado.
  - Cada bloqueio vai para o registro de auditoria (`app.locked`).

- **Uso de verdade:**
  - Só a entrada que o sistema entrega à janela conta: o evento `input-event` do `webContents`, com teclas, cliques, rolagem e toque. Um script da página não gera esses eventos.
  - O principal avisa o servidor no máximo a cada 5 s.
  - No app de desktop, o sinal de uso da página (`touch`) passa a só conferir a sessão. No `next dev`, sem a ponte, ele continua contando.

- **Tempo sem uso curto só no build de teste:**
  - O principal do build de teste lê `JESUS_E2E_IDLE_MS` e manda `idleMs` na configuração. O de produção nunca manda: o código some na compilação, e o build falha se o nome sobrar.
  - A política de bloqueio do `@jesus/auth` ganhou um piso configurável (`minIdleMs`). O padrão continua 1 min, e o piso nunca fica abaixo de 1 s. Só a ponte do build de teste baixa o piso.

## Consequências

- **Página comprometida:** não mantém o Jesus aberto fingindo uso. O teste de ponta a ponta com 4 s de prazo mostra os dois lados: teclas de verdade mantêm o app aberto; eventos criados pela página não adiam o bloqueio.
- **Bloqueio do Windows:** derruba a sessão mesmo se o servidor da interface não responder, porque o pote de cookies é do principal. O servidor que não confirma é reiniciado.
- **Limite do processo:** a ponte é congelada, mas está no mesmo processo do Next. Código que já roda nele consegue ignorar os avisos. Contra isso valem o pote apagado e o reinício sem confirmação, não a ponte.
- **Só no Windows:** os eventos reais do `powerMonitor` só existem no PC do dono. Os testes disparam os mesmos tratadores por um gancho do build de teste (`emitPower`). O comportamento no Windows de verdade fica para o teste do dono.
- **O uso do resto do PC não conta como uso do Jesus.** Isso responde à pergunta 1 do plano com a proposta, que vale até o dono decidir outra coisa.

## Detalhes

`apps/desktop/src/next-host/desktop-bridge.ts` · `apps/desktop/src/main/lock-signals.ts` · `apps/desktop/src/main/index.ts` · `apps/ui/src/server/desktop-bridge.ts` · `apps/ui/src/server/auth-runtime.ts` · `packages/auth/src/lock.ts` · seções [3.12](../03-seguranca.md) e [3.20](../03-seguranca.md)
