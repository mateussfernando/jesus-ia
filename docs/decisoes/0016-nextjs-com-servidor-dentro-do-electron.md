# 0016 — Next.js com servidor dentro do Electron: rotas e Server Actions como back-end

- Status: aceita
- Data: 11/10/2026
- Substitui: a parte da [0013](0013-interface-em-nextjs-dentro-do-electron.md) que usava exportação estática (sem servidor)

## Contexto

A decisão 0013 pôs a interface em Next.js, mas como exportação estática: sem servidor, sem rotas de API e sem Server Actions, com tudo passando por IPC. O dono do projeto explicou o motivo de ter pedido o Next.js: **a facilidade de fazer front-end e back-end num lugar só, com o sistema de rotas dele**. A exportação estática desligava exatamente isso.

O cuidado que levou à exportação estática continua valendo: um servidor HTTP local (porta em `127.0.0.1`) fica ao alcance de qualquer programa do PC e, por falsificação de pedidos (CSRF) ou *DNS rebinding*, de qualquer site aberto no navegador. O Jesus guarda dados pessoais e, depois, tokens de contas.

Testes de 11/10/2026 com o Next.js 16.4:

- O app com servidor (`next build` + `next start`) funcionou com páginas geradas a cada pedido, Server Actions e o `proxy.ts` (o antigo *middleware*, que no Next 16 roda em Node.js).
- **Sem porta nenhuma:** o servidor do Next carregado no próprio processo (`next({ dir }).getRequestHandler()`), recebendo pedidos no formato `fetch` (o mesmo que o `protocol.handle` do Electron entrega) por um adaptador em memória, respondeu: o redirecionamento para a tela de entrada, a página com a CSP de nonce e a Server Action que cria a senha, com o cookie de sessão. As ações de sessão também funcionaram nas páginas que as usam.
- Limite encontrado: quando uma Server Action é chamada numa página que **não** a contém, o Next tenta repassar o pedido a si mesmo por HTTP, o que falha sem porta. No uso normal (cada página chama as ações que importa) isso não acontece.
- Uma Server Action vinda de outra origem (`Origin` diferente do `Host`) foi recusada pelo Next e não contou tentativa de senha.

## Decisão

- **O `apps/ui` é um app Next.js completo:** páginas (App Router), Server Actions e, quando precisar, *route handlers* (`app/**/route.ts`) são o **back-end da interface**: tela de entrada (senha com bcrypt), configurações, telas de permissões e de memória, e o canal do chat com o Cérebro.
- **No app instalado, nenhuma porta é aberta.** O Electron intercepta, só na sessão da janela do Jesus, os pedidos de um endereço fixo que não existe na internet (`https://jesus.invalid/`) e entrega cada um ao servidor do Next carregado no próprio app. Qualquer outro endereço pedido por essa janela é recusado. Assim, outros programas e sites não alcançam o back-end, e cookies `Secure`, a checagem de origem das Server Actions e a CSP funcionam como num site https comum. O detalhe (no processo principal ou num `utilityProcess` só para o Next, que não trava as janelas) fica para a fase 1, com medição.
- **Em desenvolvimento**, o `next dev` escuta só em `127.0.0.1:5173`.
- **CSP com nonce** gerado a cada pedido no `src/proxy.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src` com o mesmo nonce, sem `unsafe-inline`; `unsafe-eval` só no desenvolvimento), mais `X-Frame-Options`, `nosniff`, `no-referrer` e `Permissions-Policy`. Toda página é dinâmica (`connection()` no layout raiz). O passo de hashes da 0013 sai.
- **Sessão:** depois da senha certa, um cookie `HttpOnly`, `SameSite=Strict`, `Path=/` (e `Secure` no app, que roda em https) com 256 bits aleatórios; o servidor guarda só o SHA-256 dele. Bloquear (por tempo sem uso, pelo botão, pelo Windows ou pela suspensão) apaga a sessão. Cada página protegida e cada Server Action confere a sessão por conta própria (o layout não basta, porque não roda de novo a cada navegação).
- **Fronteiras de confiança que não mudam:** o back-end do Next é o "processo principal" da interface. Ele **não executa ferramentas** nem guarda tokens de contas: o Cérebro, o Porteiro e o Executor continuam em processos próprios, e as rotas conversam com eles por IPC (seção 2.2). Toda Server Action valida a entrada com Zod e confere a sessão (as que existem antes do desbloqueio, como criar a senha e desbloquear, passam pela espera progressiva do `@jesus/auth`).
- **Onde fica a senha:** num arquivo JSON da pasta de dados (`JESUS_DATA_DIR`; no desenvolvimento, `apps/ui/.jesus-dev`), com troca atômica e falha fechada se o arquivo for adulterado, até o PostgreSQL embutido chegar (fase 4). O repositório Prisma (`@jesus/db`) já existe e entra pela variável `JESUS_DATABASE_URL`.

## Consequências

- O dono ganha o que pediu: tela e back-end no mesmo app, com rotas e Server Actions; menos código de IPC para escrever.
- O app instalado leva o servidor do Next (mais memória que uma exportação estática; a medir no alvo de 8 GB) e um adaptador de pedidos a manter. Toda Server Action é um ponto de entrada e precisa validar e autorizar sozinha; a revisão de PR confere isso.
- A interface deixa de ser publicada como artefato estático no CI (não existe mais a pasta `out`); o CI continua compilando o app.
- Para testar no navegador, o `npm run dev:hologram` pede a criação da senha local na primeira vez (guardada em `apps/ui/.jesus-dev`, fora do git).

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seção 3.12) · [04-tecnologias.md](../04-tecnologias.md) (seções 4.3 e 4.4) · [08-holograma.md](../08-holograma.md) (seção 8.8) · `apps/ui/src/proxy.ts` · `apps/ui/src/server/`
