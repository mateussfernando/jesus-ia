# Registro de decisões (ADR)

Cada decisão importante do projeto fica num arquivo próprio, curto, com contexto, decisão e consequências. Decisões não são apagadas: quando mudam, criamos uma nova que **substitui** a anterior e marcamos a antiga como "substituída".

| Nº | Decisão | Status |
|---|---|---|
| [0001](0001-harness-proprio-inspirado-no-claude-code.md) | Harness próprio, inspirado no Claude Code | aceita |
| [0002](0002-typescript-e-electron.md) | TypeScript + Electron | aceita (gerenciador de pacotes substituído pela 0009; interface em Next.js pela 0013) |
| [0003](0003-porteiro-fora-da-ia.md) | Porteiro de segurança fora da IA | aceita |
| [0004](0004-postgresql-local.md) | PostgreSQL local embutido + pgvector | aceita |
| [0005](0005-hardware-alvo.md) | Alvo de 8 a 16 GB de RAM, sem GPU dedicada | aceita |
| [0006](0006-comandos-direto-no-windows.md) | Comandos direto no Windows, WSL2 opcional | aceita |
| [0007](0007-padroes-iniciais.md) | Padrões iniciais (nomes, uso pessoal, contas, retenção, voz) | aceita |
| [0008](0008-holograma-como-pacote-e-laboratorio.md) | Holograma como pacote próprio, com laboratório web | aceita (pnpm substituído pela 0009; laboratório em Vite, pela 0013) |
| [0009](0009-npm-em-vez-de-pnpm.md) | npm workspaces em vez de pnpm | aceita |
| [0010](0010-primeiro-modelo-deepseek-via-deepinfra.md) | Primeiro modelo: DeepSeek V4.1-Flash na DeepInfra | substituída por 0011 |
| [0011](0011-primeiro-modelo-claude-haiku.md) | Primeiro modelo: Claude Haiku 5.5 | aceita |
| [0012](0012-conversa-por-voz-antes-da-execucao.md) | Conversa por voz antes da execução (nova fase 1.5) | aceita |
| [0013](0013-interface-em-nextjs-dentro-do-electron.md) | Interface em Next.js dentro do Electron (laboratório vira a aba Cenários) | aceita (exportação estática substituída pela 0016) |
| [0014](0014-prisma-como-orm.md) | Prisma como ORM do PostgreSQL (substitui o Drizzle da seção 4.3) | aceita |
| [0015](0015-senha-local-com-bcrypt-e-dados-cifrados.md) | Senha local com bcrypt e dados cifrados com AES-256-GCM | aceita |
| [0016](0016-nextjs-com-servidor-dentro-do-electron.md) | Next.js com servidor dentro do Electron: rotas e Server Actions como back-end, sem porta | aceita (onde o servidor roda: 0017) |
| [0017](0017-servidor-do-next-num-utilityprocess.md) | Servidor do Next num utilityProcess, falando com o principal por uma ponte | aceita |
| [0018](0018-empacotamento-com-electron-builder.md) | Empacotamento com electron-builder: fusíveis, asar e instalador por usuário | aceita |
| [0019](0019-bloqueio-pelos-eventos-do-windows.md) | Bloqueio pelos eventos do Windows e ponte do servidor da interface com o principal | aceita |
| [0020](0020-cofre-da-chave-no-processo-principal.md) | Cofre da chave no processo principal e tela Configurações | aceita |
| [0021](0021-porteiro-minimo-para-leituras.md) | Porteiro mínimo para a leitura de arquivos: caminhos do Windows pelo texto, pastas liberadas, leitura sensível e pastas do Jesus negadas | aceita |
| [0022](0022-registro-de-auditoria-e-mascaramento.md) | Registro de auditoria encadeado, mascaramento de segredos e logger com redação | aceita (âncora no cofre pela 0020) |
| [0023](0023-cerebro-e-saida-para-a-api.md) | Cérebro num utilityProcess e saída para a API pelo processo principal | aceita |
| [0024](0024-laco-da-conversa-no-cerebro.md) | Laço da conversa no Cérebro: conversa só na memória, histórico sem raciocínio e limite pelo orçamento | aceita |
| [0025](0025-tela-de-conversa.md) | Tela de conversa: texto puro, turno por rota com conferência de origem e parada ao bloquear | aceita |
| [0026](0026-ferramentas-de-leitura-e-pastas-liberadas.md) | Ferramentas de leitura (`file_read`, `file_list`, `file_search`) e pastas liberadas: links conferidos antes de seguidos, busca literal no texto já mascarado e pastas pessoais só por subpasta | aceita |

## Modelo

```markdown
# NNNN — Título curto

- Status: proposta | aceita | substituída por NNNN | aceita (parte substituída por NNNN)
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
