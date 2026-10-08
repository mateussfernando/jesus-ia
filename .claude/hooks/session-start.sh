#!/bin/bash
# Gancho de início de sessão do Claude Code (SessionStart).
#
# 1. Em toda sessão (local ou na nuvem): mostra o diário de bordo, docs/progresso.md, para o agente
#    verificar o andamento antes de qualquer tarefa. O que este script imprime na saída padrão entra
#    no contexto da sessão.
# 2. Só nas sessões na nuvem: garante o npm 11.16+ exigido pelo projeto (a imagem vem com o npm 10)
#    e instala as dependências, para lint e testes funcionarem.
#
# Nunca falha a sessão: qualquer erro vira um aviso curto, e o script sempre termina com código 0.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
PROGRESS="$ROOT/docs/progresso.md"
NPM_VERSION="11.21.0"   # versão exata e já madura (a instalação global não passa pelo min-release-age)
NPM_MIN="11.16.0"
LOG="${TMPDIR:-/tmp}/jesus-session-start.log"

# Saída 0 se a versão $1 for maior ou igual a $2 (semver simples x.y.z).
version_at_least() {
  node -e '
    const [a, b] = process.argv.slice(1).map((v) => v.split(".").map((n) => parseInt(n, 10) || 0));
    for (let i = 0; i < 3; i++) {
      if ((a[i] ?? 0) > (b[i] ?? 0)) process.exit(0);
      if ((a[i] ?? 0) < (b[i] ?? 0)) process.exit(1);
    }
    process.exit(0);
  ' "$1" "$2"
}

prepare_cloud() {
  [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || return 0
  command -v node >/dev/null 2>&1 || { echo "node não encontrado"; return 1; }

  local current
  current="$(npm -v 2>/dev/null || echo 0.0.0)"
  if ! version_at_least "$current" "$NPM_MIN"; then
    echo "npm $current < $NPM_MIN: instalando npm@$NPM_VERSION"
    # Fora da pasta do projeto, para não misturar a configuração do projeto com a instalação global.
    (cd "$HOME" && npm install -g "npm@$NPM_VERSION") || return 1
    hash -r
  fi

  # npm install (e não npm ci) aproveita o cache do contêiner; o .npmrc do projeto mantém as
  # proteções (scripts de instalação bloqueados, atraso de 3 dias para versões novas).
  (cd "$ROOT" && npm install --no-audit --no-fund) || return 1
}

if ! prepare_cloud >"$LOG" 2>&1; then
  echo "Aviso do gancho de início: o preparo do npm ou das dependências falhou (detalhes em $LOG)."
  echo "Rode à mão: npm install -g npm@$NPM_VERSION && npm install"
  echo
fi

if [ -f "$PROGRESS" ]; then
  echo "Diário de bordo do projeto (docs/progresso.md). Verifique o andamento antes de qualquer tarefa"
  echo "e atualize este arquivo ao terminar cada etapa."
  echo
  cat "$PROGRESS"
else
  echo "Aviso: docs/progresso.md não encontrado; confira o CLAUDE.md e o docs/10-roadmap.md."
fi

exit 0
