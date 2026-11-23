#!/usr/bin/env bash
# Stage the native runtime (Node.js + PostgreSQL for Android) for one ABI.
#
#   apps/android/scripts/stage-runtime.sh arm64-v8a   # real phones
#   apps/android/scripts/stage-runtime.sh x86_64      # the Android emulator
#
# Output: apps/android/build/stage/runtime-<abi>.tar.gz, unpacked by the app
# into its private files dir on first start.
#
# Source: Termux's prebuilt Android packages (nodejs-lts, postgresql and their
# libraries). Termux's libandroid-shmem.so is replaced with native/sysv-shm.c:
# the original hard-codes /data/data/com.termux/... and loops forever in any
# other app (see that file's header).
set -euo pipefail
ABI="${1:?usage: stage-runtime.sh arm64-v8a|x86_64}"
case "$ABI" in
  arm64-v8a) ARCH=aarch64; TARGET=aarch64-linux-android24 ;;
  x86_64)    ARCH=x86_64;  TARGET=x86_64-linux-android24 ;;
  *) echo "unsupported ABI: $ABI" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK="$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -1)"
[ -n "$NDK" ] || { echo "Android NDK not found in $SDK/ndk" >&2; exit 1; }
CLANG="$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/bin | head -1)/clang"

WORK="$HERE/build/termux-$ARCH"
STAGE="$HERE/build/stage"
mkdir -p "$WORK" "$STAGE"

echo "▶ Fetching Termux packages for ${ARCH}…"
curl -fsSL -o "$WORK/Packages" "https://packages.termux.dev/apt/termux-main/dists/stable/main/binary-$ARCH/Packages"
rm -rf "$WORK/root"
python3 -I "$HERE/scripts/termux_fetch.py" "$WORK/Packages" "$ARCH" "$WORK" nodejs-lts postgresql | tail -3

USR="$WORK/root/data/data/com.termux/files/usr"
RT="$WORK/runtime/usr"
rm -rf "$WORK/runtime"
mkdir -p "$RT/bin" "$RT/lib" "$RT/share" "$RT/etc"

echo "▶ Selecting what the app needs…"
for b in node postgres initdb pg_ctl pg_isready psql createdb pg_dump pg_restore; do
  cp -P "$USR/bin/$b" "$RT/bin/"
done
# Shared libraries (keep symlinks), PostgreSQL's own modules (plpgsql etc.).
(cd "$USR/lib" && find . -maxdepth 1 \( -name '*.so' -o -name '*.so.*' \) -print0 | xargs -0 -I{} cp -P {} "$RT/lib/")
cp -R "$USR/lib/postgresql" "$RT/lib/postgresql"
cp -R "$USR/share/postgresql" "$RT/share/postgresql"
cp -R "$USR/etc/tls" "$RT/etc/tls"

echo "▶ Building the SysV shared-memory replacement for ${ABI}…"
"$CLANG" --target="$TARGET" -O2 -fPIC -shared -Wall -Wextra -Wl,-soname,libandroid-shmem.so \
  -o "$RT/lib/libandroid-shmem.so" "$HERE/native/sysv-shm.c"

echo "▶ Packing…"
(cd "$WORK/runtime" && tar -czf "$STAGE/runtime-$ABI.tar.gz" usr)
echo "✔ Runtime $ABI: $(du -sh "$WORK/runtime" | cut -f1) unpacked, $(du -h "$STAGE/runtime-$ABI.tar.gz" | cut -f1) compressed"
