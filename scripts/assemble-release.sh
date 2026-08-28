#!/bin/bash
# Assemble release-v1.3.4/ folder with all artifacts needed to draft the GitHub release.
# Mirrors the v1.3.2 release structure: 15 assets + latest.json manifest.
set -e
cd /Users/virus/Downloads/RexaDB

VER="1.3.4"
OUT="release-v1.3.4"
mkdir -p "$OUT"
rm -f "$OUT"/*

# ── macOS ARM (fresh local builds) ──────────────────────────
cp src-tauri/target/release/bundle/macos/RexaDB.app.tar.gz        "$OUT/RexaDB_${VER}_aarch64.app.tar.gz"
cp src-tauri/target/release/bundle/macos/RexaDB.app.tar.gz.sig     "$OUT/RexaDB_${VER}_aarch64.app.tar.gz.sig"
cp src-tauri/target/release/bundle/dmg/RexaDB_${VER}_aarch64.dmg   "$OUT/"
cp src-tauri/target/release/bundle/dmg/RexaDB_${VER}_aarch64.dmg.sig "$OUT/"

# ── macOS Intel (fresh local builds) ────────────────────────
cp src-tauri/target/x86_64-apple-darwin/release/bundle/macos/RexaDB.app.tar.gz        "$OUT/RexaDB_${VER}_x64.app.tar.gz"
cp src-tauri/target/x86_64-apple-darwin/release/bundle/macos/RexaDB.app.tar.gz.sig     "$OUT/RexaDB_${VER}_x64.app.tar.gz.sig"
cp src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/RexaDB_${VER}_x64.dmg       "$OUT/"
cp src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/RexaDB_${VER}_x64.dmg.sig   "$OUT/"

# ── Linux (from dist-artifacts, CI-built) ───────────────────
cp dist-artifacts-1.3.4/RexaDB_${VER}_amd64.deb          "$OUT/"
cp dist-artifacts-1.3.4/RexaDB_${VER}_amd64.deb.sig      "$OUT/"
cp dist-artifacts-1.3.4/RexaDB_${VER}_x86_64.AppImage    "$OUT/"
cp dist-artifacts-1.3.4/RexaDB_${VER}_x86_64.AppImage.sig "$OUT/"

# ── Windows (from dist-artifacts, CI-built) ────────────────
cp dist-artifacts-1.3.4/RexaDB_${VER}_x64-setup.exe      "$OUT/"
cp dist-artifacts-1.3.4/RexaDB_${VER}_x64-setup.exe.sig  "$OUT/"

# ── Read signatures ────────────────────────────────────────
sig_arm_app=$(cat "$OUT/RexaDB_${VER}_aarch64.app.tar.gz.sig")
sig_arm_dmg=$(cat "$OUT/RexaDB_${VER}_aarch64.dmg.sig")
sig_x64_app=$(cat "$OUT/RexaDB_${VER}_x64.app.tar.gz.sig")
sig_x64_dmg=$(cat "$OUT/RexaDB_${VER}_x64.dmg.sig")
sig_deb=$(cat "$OUT/RexaDB_${VER}_amd64.deb.sig")
sig_appimage=$(cat "$OUT/RexaDB_${VER}_x86_64.AppImage.sig")
sig_exe=$(cat "$OUT/RexaDB_${VER}_x64-setup.exe.sig")

BASE="https://github.com/rexadbapp/RexaDB/releases/download/v${VER}"

# ── Generate latest.json (8 platform keys, matching v1.3.2) ─
cat > "$OUT/latest.json" <<JSON
{
  "version": "${VER}",
  "notes": "RexaDB ${VER}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "url": "${BASE}/RexaDB_${VER}_aarch64.app.tar.gz",
      "signature": "${sig_arm_app}"
    },
    "darwin-x86_64": {
      "url": "${BASE}/RexaDB_${VER}_x64.app.tar.gz",
      "signature": "${sig_x64_app}"
    },
    "linux-x86_64": {
      "url": "${BASE}/RexaDB_${VER}_x86_64.AppImage",
      "signature": "${sig_appimage}"
    },
    "linux-x86_64-appimage": {
      "url": "${BASE}/RexaDB_${VER}_x86_64.AppImage",
      "signature": "${sig_appimage}"
    },
    "linux-x86_64-deb": {
      "url": "${BASE}/RexaDB_${VER}_amd64.deb",
      "signature": "${sig_deb}"
    },
    "windows-x86_64": {
      "url": "${BASE}/RexaDB_${VER}_x64-setup.exe",
      "signature": "${sig_exe}"
    },
    "windows-x86_64-nsis": {
      "url": "${BASE}/RexaDB_${VER}_x64-setup.exe",
      "signature": "${sig_exe}"
    }
  }
}
JSON

# ── Generate release-notes.md ──────────────────────────────
cat > "$OUT/release-notes.md" <<EOF
**Full Changelog**: https://github.com/rexadbapp/RexaDB/compare/v1.3.3...v${VER}

RexaDB ${VER} — Neon provider integration, unified provider-accounts UI, new onboarding flow, connection manager overhaul, and Studio sidebar/header polish.
EOF

echo "=== ${OUT} contents ==="
ls -lhS "$OUT/"
echo
echo "=== latest.json ==="
cat "$OUT/latest.json"
echo
echo "=== release-notes.md ==="
cat "$OUT/release-notes.md"
echo
echo "=== asset count ==="
ls "$OUT" | grep -c .
echo "=== done ==="
