#!/usr/bin/env bash
# Build the Kaappi Biller Android app (APK) with the Android SDK's command-line
# tools only (aapt2, javac, d8, zipalign, apksigner); no Gradle needed.
#
#   apps/android/build.sh                 # arm64-v8a: real phones and tablets
#   apps/android/build.sh x86_64          # the Android emulator on an Intel Mac
#   REBUILD=1 apps/android/build.sh       # restage runtime, backend and web UI first
#
# Output: apps/android/build/KaappiBiller-<abi>.apk
#
# The APK carries the whole system for "Main device" mode (see Supervisor.java):
#   assets/runtime-<abi>.tar.gz  Node.js + PostgreSQL for Android  (scripts/stage-runtime.sh)
#   assets/backend.tar.gz        the NestJS backend, production-only (scripts/stage-backend.sh)
#   assets/web.tar.gz            the web UI as a static export      (scripts/stage-web.sh)
#
# Needs: JDK 17+, and in $ANDROID_HOME (default ~/Library/Android/sdk):
#   platforms;android-35, build-tools;35.0.0 and an NDK (for the runtime stage).
set -euo pipefail
cd "$(dirname "$0")"
ABI="${1:-arm64-v8a}"

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
[ -x "$BT/aapt2" ] && [ -f "$JAR" ] || {
  echo "Android SDK pieces missing in $SDK. Install with:" >&2
  echo "  $SDK/cmdline-tools/latest/bin/sdkmanager \"platforms;android-35\" \"build-tools;35.0.0\"" >&2
  exit 1
}

VERSION_NAME="1.1.0"
VERSION_CODE="$(date +%y%m%d%H)" # newer build always installs over the old one

# ── The bundled system (staged once; REBUILD=1 to refresh) ──────────────────
STAGE=build/stage
if [ -n "${REBUILD:-}" ] || [ ! -f "$STAGE/runtime-$ABI.tar.gz" ]; then scripts/stage-runtime.sh "$ABI"; fi
if [ -n "${REBUILD:-}" ] || [ ! -f "$STAGE/backend.tar.gz" ]; then scripts/stage-backend.sh; fi
if [ -n "${REBUILD:-}" ] || [ ! -f "$STAGE/web.tar.gz" ]; then
  [ -d "$STAGE/web" ] || scripts/stage-web.sh
  (cd "$STAGE" && tar -czf web.tar.gz web)
fi

# Default address offered in "Join a shop" mode: this Mac's Wi-Fi IP (a main
# device listens on :1995; type :3000 explicitly to join the Mac's dev server).
if [ -z "${SERVER_URL:-}" ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  SERVER_URL="http://${IP:-192.168.1.2}:1995"
fi

B="build/apk-$ABI"
rm -rf "$B"
mkdir -p "$B/gen" "$B/classes" "$B/dex" "$B/compiled" "$B/extra/values" "$B/assets"

echo "▶ Assets for ${ABI}…"
cp "$STAGE/runtime-$ABI.tar.gz" "$STAGE/backend.tar.gz" "$STAGE/web.tar.gz" "$B/assets/"
echo "$ABI" > "$B/assets/abi.txt"
# Content fingerprint: the app re-unpacks the bundle only when this changes.
cat "$B"/assets/*.tar.gz | shasum -a 256 | cut -c1-16 > "$B/assets/bundle-version.txt"

# ── App icons from the web app's Kaappi 2.0 emblem ───────────────────────────
ICON_SRC=../web/public/icons/icon-512.png # transparent round emblem
RES_ICONS="$B/icons"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dens="${d%%:*}"; px="${d##*:}"
  mkdir -p "$RES_ICONS/mipmap-$dens"
  sips -z "$px" "$px" "$ICON_SRC" --out "$RES_ICONS/mipmap-$dens/ic_launcher.png" >/dev/null
  # Adaptive-icon foreground: 108dp canvas, emblem inside the 66dp safe zone.
  fg=$(( px * 108 / 48 )); inner=$(( fg * 62 / 100 ))
  sips -z "$inner" "$inner" "$ICON_SRC" --out "$RES_ICONS/fg-tmp.png" >/dev/null
  sips -p "$fg" "$fg" --padColor 1E1513 "$RES_ICONS/fg-tmp.png" --out "$RES_ICONS/mipmap-$dens/ic_launcher_foreground.png" >/dev/null 2>&1
done
rm -f "$RES_ICONS/fg-tmp.png"

cat > "$B/extra/values/server.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources><string name="default_server" translatable="false">$SERVER_URL</string></resources>
EOF

# ── Resources → base APK + R.java ───────────────────────────────────────────
# targetSdk 28: lets the app run its bundled Node.js/PostgreSQL binaries from
# its own files dir (Android forbids that from API 29 targets). This is how
# Termux works; a Play Store release would need the binaries moved into the
# APK's native-library folder instead.
echo "▶ Compiling resources…"
"$BT/aapt2" compile --dir res -o "$B/compiled/res.zip"
"$BT/aapt2" compile --dir "$RES_ICONS" -o "$B/compiled/icons.zip"
"$BT/aapt2" compile "$B/extra/values/server.xml" -o "$B/compiled/"
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 26 --target-sdk-version 28 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$B/assets" -0 gz -0 txt \
  --java "$B/gen" -o "$B/base.apk" "$B"/compiled/*.zip "$B"/compiled/*.flat

# ── Java → DEX ──────────────────────────────────────────────────────────────
echo "▶ Compiling code…"
javac -nowarn -Xlint:-options -source 11 -target 11 -classpath "$JAR" -d "$B/classes" \
  $(find src "$B/gen" -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')

# ── Package, align, sign ────────────────────────────────────────────────────
echo "▶ Packaging and signing…"
cp "$B/base.apk" "$B/unsigned.apk"
(cd "$B/dex" && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"

# A local test-signing key, kept outside the repo. Every build from this Mac uses
# the same key, so a new APK installs over the old one without uninstalling.
KS="$HOME/.android/kaappi-biller-test.keystore"
if [ ! -f "$KS" ]; then
  mkdir -p "$HOME/.android"
  keytool -genkeypair -keystore "$KS" -storepass kaappi-test -keypass kaappi-test \
    -alias kaappi -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Kaappi Biller test build" >/dev/null 2>&1
fi
OUT="build/KaappiBiller-$ABI.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:kaappi-test --key-pass pass:kaappi-test \
  --ks-key-alias kaappi --out "$OUT" "$B/aligned.apk"
"$BT/apksigner" verify "$OUT"

ls -lh "$OUT" | awk '{print "✔ Built", $9, "(" $5 ")"}'
