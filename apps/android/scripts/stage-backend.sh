#!/usr/bin/env bash
# Stage the Kaappi Biller backend as a self-contained, production-only bundle
# for the Android embedded server (pure JavaScript: no native Node add-ons).
#
#   apps/android/scripts/stage-backend.sh
#
# Output: apps/android/build/stage/backend/  (and backend.tar.gz next to it)
# Mirrors windows/msix/stage-server-assets.ps1: build, `pnpm deploy --prod`,
# regenerate the Prisma client inside the bundle, prune.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/apps/android/build/stage"
BACKEND_OUT="$OUT/backend"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM="corepack pnpm"
# pnpm re-invokes `pnpm` from PATH for its dependency checks; make sure that is
# the repo's pinned version via corepack, not a different global (e.g. Homebrew) pnpm.
SHIM_DIR="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexec corepack pnpm "$@"\n' > "$SHIM_DIR/pnpm"
chmod +x "$SHIM_DIR/pnpm"
export PATH="$SHIM_DIR:$PATH"
trap 'rm -f "$SHIM_DIR/pnpm"; rmdir "$SHIM_DIR" 2>/dev/null || true' EXIT

cd "$ROOT"
echo "▶ Building shared types and backend…"
$PNPM --filter @nodedr-restaurant/types build >/dev/null
(cd apps/backend && ./node_modules/.bin/prisma generate >/dev/null && ./node_modules/.bin/nest build)

echo "▶ Staging production dependencies (pnpm deploy)…"
rm -rf "$BACKEND_OUT"
mkdir -p "$OUT"
# `pnpm deploy --prod` records its own settings (production-only, hoisted) as
# the workspace's install state; the next `pnpm run`/`dev` would then try to
# reinstall the developer's node_modules that way. Keep the real state.
STATE="$ROOT/node_modules/.pnpm-workspace-state-v1.json"
STATE_BACKUP="$(mktemp)"
cp "$STATE" "$STATE_BACKUP"
restore_state() { cp "$STATE_BACKUP" "$STATE" && rm -f "$STATE_BACKUP"; }
$PNPM --filter @nodedr-restaurant/backend deploy --prod --legacy --config.node-linker=hoisted "$BACKEND_OUT" >/dev/null || { restore_state; exit 1; }
restore_state

cd "$BACKEND_OUT"
echo "▶ Generating the Prisma client inside the bundle (engineType = client: JS/WASM only)…"
node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma >/dev/null
rm -rf dist && cp -R "$ROOT/apps/backend/dist" dist

echo "▶ Pruning desktop-only and build-time files…"
# Prisma CLI + native engines: the phone uses prisma/apply-migrations.js and the
# client's WASM query compiler instead.
rm -rf node_modules/prisma node_modules/@prisma/engines node_modules/@prisma/engines-version \
       node_modules/@prisma/fetch-engine node_modules/@prisma/get-platform node_modules/@prisma/debug/dist/*.map
find node_modules/.prisma node_modules/@prisma -name '*.node' -delete 2>/dev/null || true
find node_modules/.prisma node_modules/@prisma -name 'libquery_engine*' -delete 2>/dev/null || true
# USB thermal printing is Linux-host-only and is lazily loaded (tolerated if missing).
rm -rf node_modules/usb
# Sources, maps, docs, tests and the dev .env never ship.
find . -name '*.map' -delete
find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -iname 'README*' -o -iname 'CHANGELOG*' -o -iname 'HISTORY*' \) -delete
find node_modules -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} +
rm -rf src test .env .env.* tsconfig*.json nest-cli.json eslint.config.mjs

echo "▶ Checking for native add-ons (none may remain)…"
natives=$(find . -name '*.node' | grep -v '^./node_modules/.prisma/client/.*wasm' || true)
if [ -n "$natives" ]; then
  echo "Native add-ons found (won't run on Android):" >&2
  echo "$natives" >&2
  exit 1
fi

echo "▶ Bundling (esbuild): ~17,000 files → about 1,000, so the phone unpacks it in seconds…"
BUNDLE="$OUT/backend-bundle"
node "$ROOT/apps/android/scripts/bundle-backend.mjs" "$BACKEND_OUT" "$BUNDLE"

cd "$OUT"
# The archive's top folder must be "backend" (Supervisor runs backend/dist/src/main.js).
rm -rf pack && mkdir pack && mv "$BUNDLE" pack/backend
tar -czf backend.tar.gz -C pack backend
echo "✔ Backend staged: $(find pack/backend -type f | wc -l | tr -d ' ') files, $(du -sh pack/backend | cut -f1) on disk, $(du -h backend.tar.gz | cut -f1) compressed"
rm -rf pack
