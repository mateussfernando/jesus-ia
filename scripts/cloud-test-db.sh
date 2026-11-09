#!/bin/bash
# Sobe um PostgreSQL de teste nas sessões na nuvem (Linux com o PostgreSQL instalado e acesso de root), para
# rodar os testes de integração do @jesus/db (decisão 0014). Nada aqui vale para o PC do dono nem para o app.
#
# Uso: bash scripts/cloud-test-db.sh   →   mostra a linha `export JESUS_TEST_DATABASE_URL=...`
set -euo pipefail

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$PG_BIN" ] || { echo "PostgreSQL não encontrado em /usr/lib/postgresql" >&2; exit 1; }
DATA=/var/lib/postgresql/jesus-test
PORT=54329
PASS_FILE=/var/lib/postgresql/jesus-test.pw

if [ ! -f "$PASS_FILE" ]; then
  runuser -u postgres -- bash -c "umask 077 && head -c 24 /dev/urandom | base64 | tr -d '/+=' > $PASS_FILE"
fi
PASS="$(cat "$PASS_FILE")"

if [ ! -d "$DATA" ]; then
  runuser -u postgres -- "$PG_BIN/initdb" -D "$DATA" -A scram-sha-256 -U postgres --pwfile="$PASS_FILE" \
    -E UTF8 --locale=C.UTF-8 >/dev/null
fi
if ! runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DATA" \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -k /var/lib/postgresql" -l "$DATA/log.txt" start >/dev/null
fi
echo "export JESUS_TEST_DATABASE_URL=postgresql://postgres:${PASS}@127.0.0.1:${PORT}/postgres"
