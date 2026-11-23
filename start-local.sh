#!/usr/bin/env bash
# Start Kaappi Biller on this Mac: database (Docker), backend API (:4001) and
# website (:3000). Press Ctrl+C to stop the backend and website.
#
#   ./start-local.sh
#
# First-time setup on a new machine is described at the bottom of this file.
set -u
cd "$(dirname "$0")"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM="corepack pnpm" # the repo pins pnpm 11.10.0; Homebrew's pnpm refuses to run it

say() { printf '\033[1;33m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
in_use() { lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 1. Docker + database
if ! docker info >/dev/null 2>&1; then
  say "Starting Docker Desktop…"
  open -a Docker || fail "Docker Desktop is not installed."
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "Docker did not start. Open Docker Desktop and try again."
fi
if ! docker ps --format '{{.Names}}' | grep -qx petpooja-postgres; then
  say "Starting the database…"
  docker start petpooja-postgres >/dev/null || fail "No 'petpooja-postgres' container. See first-time setup at the bottom of this script."
fi
for _ in $(seq 1 30); do docker exec petpooja-postgres pg_isready -U nodedr >/dev/null 2>&1 && break; sleep 1; done
docker exec petpooja-postgres pg_isready -U nodedr >/dev/null 2>&1 || fail "The database is not ready."

# 2. Backend + website (skipped if already running)
pids=()
cleanup() { [ ${#pids[@]} -gt 0 ] && kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null; echo; say "Stopped."; }
trap cleanup EXIT INT TERM

if in_use 4001; then
  say "Backend already running on :4001"
else
  say "Starting the backend API on :4001…"
  $PNPM --filter @nodedr-restaurant/backend dev &
  pids+=($!)
fi

if in_use 3000; then
  say "Website already running on :3000"
else
  say "Starting the website on :3000…"
  $PNPM --filter web dev &
  pids+=($!)
fi

say "Waiting for the backend and website (the backend compiles for up to a minute)…"
ready=0
for _ in $(seq 1 180); do
  # Any HTTP answer from the API (even 401) means it is listening.
  if curl -s -o /dev/null http://localhost:4001/api/v1/auth/me && curl -s -o /dev/null http://localhost:3000/login; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || fail "Not ready after 3 minutes. Check the messages above for errors."
say "Ready: http://localhost:3000   (demo login: owner@demo.local / Password123!)"
open http://localhost:3000 2>/dev/null

if [ ${#pids[@]} -eq 0 ]; then
  say "Everything was already running; nothing to keep open."
  trap - EXIT
  exit 0
fi
say "Press Ctrl+C to stop."
wait

# ── First-time setup on a new machine (run once) ─────────────────────────────
#   corepack pnpm install
#   docker run -d --name petpooja-postgres --restart unless-stopped \
#     -e POSTGRES_USER=nodedr -e POSTGRES_PASSWORD=nodedr_dev_pw -e POSTGRES_DB=nodedr_restaurant \
#     -p 127.0.0.1:5435:5432 -v petpooja_pg_data:/var/lib/postgresql/data postgres:16-alpine
#   cp apps/backend/.env.example apps/backend/.env
#     → in apps/backend/.env change 5432 to 5435, and set JWT_SECRET (openssl rand -hex 32)
#   corepack pnpm --filter @nodedr-restaurant/types build
#   (cd apps/backend && corepack pnpm exec prisma migrate deploy && corepack pnpm exec ts-node prisma/seed.ts)
