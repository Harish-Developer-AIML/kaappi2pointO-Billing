#!/usr/bin/env bash
# Bump the Kaappi Biller version (the VERSION file at the repo root).
#
#   scripts/bump-version.sh patch   # a bug fix          1.2.0 -> 1.2.1
#   scripts/bump-version.sh minor   # new features       1.2.1 -> 1.3.0
#   scripts/bump-version.sh major   # big/breaking change 1.3.0 -> 2.0.0
#
# VERSION is the single source: the Android app (apps/android/build.sh), the web
# UI (next.config.ts -> NEXT_PUBLIC_APP_VERSION, shown in the sidebar/settings)
# and the embedded backend (APP_VERSION) all read it. Also adds a heading for
# the new version to CHANGELOG.md; write what changed under it.
set -euo pipefail
cd "$(dirname "$0")/.."
part="${1:-}"
current="$(tr -d '[:space:]' < VERSION)"
IFS=. read -r major minor patch <<< "$current"
case "$part" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) echo "usage: scripts/bump-version.sh major|minor|patch   (now $current)" >&2; exit 1 ;;
esac
next="$major.$minor.$patch"
printf '%s\n' "$next" > VERSION

if [ -f CHANGELOG.md ] && ! grep -q "^## $next " CHANGELOG.md; then
  heading="## $next — $(date +%Y-%m-%d)"
  awk -v h="$heading" 'NR==1{print; next} !done && /^## /{print h"\n\n- \n"; done=1} {print}' CHANGELOG.md > CHANGELOG.md.tmp
  mv CHANGELOG.md.tmp CHANGELOG.md
fi
echo "Version: $current -> $next (VERSION, CHANGELOG.md)"
