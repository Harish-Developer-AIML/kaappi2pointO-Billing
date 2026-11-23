#!/usr/bin/env bash
# Build the Kaappi Biller web UI as a static export for the Android app.
#
#   apps/android/scripts/stage-web.sh
#
# Output: apps/android/build/stage/web/ (served by the embedded backend).
# Built from a temporary copy of apps/web without the routes a static export
# can't contain and the phone doesn't need (guest QR ordering, the customer
# kiosk and the purchase-order detail page); apps/web itself is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/apps/web"
WORK="$ROOT/apps/android/build/web-src"
OUT="$ROOT/apps/android/build/stage/web"

echo "▶ Preparing a build copy of apps/web…"
rm -rf "$WORK"
mkdir -p "$WORK"
# Everything except build output and dependencies (linked back below).
(cd "$SRC" && tar --exclude=./node_modules --exclude=./.next --exclude=./out --exclude=./public/downloads -cf - .) | (cd "$WORK" && tar -xf -)
ln -s "$SRC/node_modules" "$WORK/node_modules"
rm -rf "$WORK/app/kiosk" "$WORK/app/order" "$WORK/app/(dashboard)/inventory/purchase-orders/[id]"

echo "▶ Building the static export (BUILD_TARGET=android)…"
(cd "$WORK" && BUILD_TARGET=android NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build)

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
cp -R "$WORK/out" "$OUT"
echo "✔ Web UI staged: $(du -sh "$OUT" | cut -f1), $(find "$OUT" -name index.html | wc -l | tr -d ' ') pages"
