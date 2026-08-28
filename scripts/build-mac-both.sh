#!/bin/bash
# Build RexaDB for both macOS architectures (Apple Silicon + Intel) with updater signing.
set -e
cd /Users/virus/Downloads/RexaDB

# --- signing key setup ---
KEY="$(cat ~/.tauri/rexadb-updater.key)"
printf '%s' "$KEY" > /tmp/rexadb-sign-key
unset TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PATH=/tmp/rexadb-sign-key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='XWJtqRPryAexbsJ54G5CTLaBVn2QQV0e'

echo "=== bun install ==="
bun install
echo "=== server deps ==="
bash -c "cd server && bun install"

echo "=== build server arm ==="
bun run scripts/build-server.mjs
echo "=== build server intel cross ==="
bun build --compile --target=bun-darwin-x64 server/index.ts --outfile=src-tauri/binaries/rexadb-server-x86_64-apple-darwin

echo "=== java bridge jar ==="
bash resources/java-bridge/build.sh --skip-jlink

# ============================================================
# ARM (Apple Silicon) build
# ============================================================
echo ""
echo "═══════════════════════════════════════════"
echo "  BUILDING ARM (aarch64) — app + dmg"
echo "═══════════════════════════════════════════"
bunx tauri build --bundles app,dmg 2>&1 | tee /tmp/tauri-mac-arm.log || true

# Tauri's bundle_dmg.sh invocation fails intermittently; build dmg manually if missing
ARM_DMG="src-tauri/target/release/bundle/dmg/RexaDB_1.3.4_aarch64.dmg"
if [ ! -f "$ARM_DMG" ]; then
  echo "--- Tauri DMG failed, building manually ---"
  bash src-tauri/target/release/bundle/dmg/bundle_dmg.sh \
    --volname "RexaDB" \
    --window-pos 200 120 \
    --window-size 500 350 \
    --icon-size 128 \
    --app-drop-link 425 220 \
    --icon "RexaDB.app" 175 220 \
    --hide-extension "RexaDB.app" \
    --volicon src-tauri/target/release/bundle/dmg/icon.icns \
    "$ARM_DMG" \
    src-tauri/target/release/bundle/macos 2>&1 | tee -a /tmp/tauri-mac-arm.log
fi

# updater bundle
echo "--- ARM updater bundle ---"
cd src-tauri/target/release/bundle/macos
rm -f RexaDB.app.tar.gz RexaDB.app.tar.gz.sig
tar czf RexaDB.app.tar.gz RexaDB.app
cd - >/dev/null
bunx tauri signer sign -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
  src-tauri/target/release/bundle/macos/RexaDB.app.tar.gz 2>&1 | tail -n 2
# sign the dmg too
if [ -f "$ARM_DMG" ]; then
  rm -f "$ARM_DMG.sig"
  bunx tauri signer sign -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "$ARM_DMG" 2>&1 | tail -n 2
fi

# ============================================================
# Intel (x86_64) build
# ============================================================
echo ""
echo "═══════════════════════════════════════════"
echo "  BUILDING INTEL (x86_64) — app + dmg"
echo "═══════════════════════════════════════════"
bunx tauri build --target x86_64-apple-darwin --bundles app,dmg 2>&1 | tee /tmp/tauri-mac-intel.log || true

INTEL_DMG="src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/RexaDB_1.3.4_x64.dmg"
if [ ! -f "$INTEL_DMG" ]; then
  echo "--- Tauri DMG failed, building manually ---"
  bash src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/bundle_dmg.sh \
    --volname "RexaDB" \
    --window-pos 200 120 \
    --window-size 500 350 \
    --icon-size 128 \
    --app-drop-link 425 220 \
    --icon "RexaDB.app" 175 220 \
    --hide-extension "RexaDB.app" \
    --volicon src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/icon.icns \
    "$INTEL_DMG" \
    src-tauri/target/x86_64-apple-darwin/release/bundle/macos 2>&1 | tee -a /tmp/tauri-mac-intel.log
fi

# updater bundle
echo "--- Intel updater bundle ---"
cd src-tauri/target/x86_64-apple-darwin/release/bundle/macos
rm -f RexaDB.app.tar.gz RexaDB.app.tar.gz.sig
tar czf RexaDB.app.tar.gz RexaDB.app
cd - >/dev/null
bunx tauri signer sign -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
  src-tauri/target/x86_64-apple-darwin/release/bundle/macos/RexaDB.app.tar.gz 2>&1 | tail -n 2
# sign the dmg too
if [ -f "$INTEL_DMG" ]; then
  rm -f "$INTEL_DMG.sig"
  bunx tauri signer sign -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "$INTEL_DMG" 2>&1 | tail -n 2
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "═══════════════════════════════════════════"
echo "  BUILD SUMMARY"
echo "═══════════════════════════════════════════"
echo "--- ARM (aarch64) ---"
ls -lh src-tauri/target/release/bundle/dmg/*.dmg* \
       src-tauri/target/release/bundle/macos/RexaDB.app.tar.gz* 2>&1
echo "--- Intel (x86_64) ---"
ls -lh src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg* \
       src-tauri/target/x86_64-apple-darwin/release/bundle/macos/RexaDB.app.tar.gz* 2>&1
echo ""
echo "=== done mac build both ==="
