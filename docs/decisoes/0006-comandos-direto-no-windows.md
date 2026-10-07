# 0006 — Comandos direto no Windows, WSL2 opcional

- Status: aceita
- Data: 07/10/2026

## Contexto

O Windows 11 Home não tem o Windows Sandbox. O Claude Code também não tem sandbox no Windows nativo: lá, os comandos rodam direto no Windows (Git Bash/PowerShell), protegidos por permissões, e o isolamento de verdade só existe rodando-o dentro do WSL2. O dono do projeto quer que o Jesus funcione sem instalar nada externo.

## Decisão

Por padrão, os comandos rodam **direto no Windows**, como no Claude Code, com compensações que usam só recursos nativos: ambiente sem segredos, token restrito (com SIDs de restrição), Job Object (limites e encerramento da árvore de processos), sem elevação e Porteiro mais rígido para o terminal. O AppContainer (já presente no Windows) é o upgrade planejado. O WSL2 fica como modo avançado opcional.

## Consequências

- Nada para o usuário instalar.
- A contenção é **parcial**: um comando aprovado ainda pode ler arquivos fora das pastas negadas, e a rede não é bloqueada pelo sistema. Por isso, comandos com rede ou que leem fora do projeto pedem confirmação.
- Token restrito e Job Object exigem um módulo nativo pequeno e testes no Windows (CI `windows-latest`).

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seção 3.6) · [10-roadmap.md](../10-roadmap.md) (fase 3)
