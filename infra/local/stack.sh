#!/usr/bin/env bash
# Sobe/derruba a stack local. Requer Docker. Uso: ./infra/local/stack.sh up|down|reset|logs|psql
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || node gen-env.mjs
set -a; . ./.env; set +a
case "${1:-up}" in
  up)    docker compose up -d ;;
  down)  docker compose down ;;
  reset) docker compose down -v ;;
  logs)  docker compose logs -f "${2:-}" ;;
  limit) # ./stack.sh limit N : define o limite de logins anônimos por hora por IP e recria o Auth (zera o contador)
    sed -i "s/^ANON_RATE_LIMIT=.*/ANON_RATE_LIMIT=${2:?informe o número}/" .env
    set -a; . ./.env; set +a
    docker compose up -d --force-recreate auth
    for _ in $(seq 1 40); do
      curl -fsS -m 2 -o /dev/null -H "apikey: $ANON_KEY" http://127.0.0.1:54321/auth/v1/health 2>/dev/null && exit 0
      sleep 1
    done
    echo "O Auth não respondeu a tempo." >&2; exit 1 ;;
  psql)  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 54322 -U postgres postgres ;;
  *) echo "uso: $0 up|down|reset|logs|psql|limit N"; exit 1 ;;
esac
