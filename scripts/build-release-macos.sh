#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build-release-macos.sh — Build macOS release (ARM64 + x86_64), notarize, push tag
#
# Usage:
#   ./scripts/build-release-macos.sh
#   APPLE_ID="me@example.com" APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx" ./scripts/build-release-macos.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}[release]${NC} $*"; }
success() { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn ]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL ]${NC} $*"; exit 1; }

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
JDK_MAJOR=21
log "RexaDB v${VERSION} macOS release build (JDK ${JDK_MAJOR})"
log ""

# ── Step 0: Apple credentials (from env → keychain → prompt) ──────────────
KEYCHAIN_LABEL="RexaDB Apple ID"
if [ -z "${APPLE_ID:-}" ]; then
  APPLE_ID=$(security find-generic-password -l "$KEYCHAIN_LABEL" -a "APPLE_ID" -w 2>/dev/null || true)
fi
if [ -z "${APPLE_PASSWORD:-}" ]; then
  APPLE_PASSWORD=$(security find-generic-password -l "$KEYCHAIN_LABEL" -a "APPLE_PASSWORD" -w 2>/dev/null || true)
fi
if [ -z "${APPLE_ID:-}" ]; then
  read -rp "Apple ID email: " APPLE_ID
fi
if [ -z "${APPLE_PASSWORD:-}" ]; then
  read -rsp "App-specific password (appleid.apple.com → Sign-In & Security): " APPLE_PASSWORD
  echo
fi
# Save to keychain for next time
security add-generic-password -l "$KEYCHAIN_LABEL" -a "APPLE_ID" -w "$APPLE_ID" -U 2>/dev/null || true
security add-generic-password -l "$KEYCHAIN_LABEL" -a "APPLE_PASSWORD" -w "$APPLE_PASSWORD" -U 2>/dev/null || true
: "${APPLE_TEAM_ID:=B5UL5U45T7}"
# Not exporting APPLE_ID/PASSWORD — Tauri skips notarization but still signs
success "Apple credentials saved (Team: $APPLE_TEAM_ID)"

# ── Check Rust targets ──────────────────────────────────────────────────────
for triple in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -q "$triple"; then
    fail "Missing Rust target: $triple — run: rustup target add $triple"
  fi
done
success "Rust targets available (aarch64 + x86_64)"

# ── Step 1: Build Java bridge ──────────────────────────────────────────────
log "Building Java bridge (ARM64 JRE + bridge.jar)..."
bash resources/java-bridge/build.sh
JRE_ARM64="resources/java-bridge/dist/jre-arm64"
BRIDGE_DIR="resources/java-bridge/dist"
mv "$BRIDGE_DIR/jre" "$JRE_ARM64"
success "ARM64 JRE + bridge.jar built"

# ── Step 2: Build x86_64 JRE (via downloaded x86_64 JDK) ──────────────────
JRE_X64="resources/java-bridge/dist/jre-x86_64"
if [ ! -d "$JRE_X64" ]; then
  log "Downloading macOS x86_64 JDK for JRE build..."
  JDK_URL="https://api.adoptium.net/v3/binary/latest/${JDK_MAJOR}/ga/mac/x64/jdk/hotspot/normal/eclipse"
  curl -fsSL "$JDK_URL" -o /tmp/jdk-x64.tar.gz
  tar xzf /tmp/jdk-x64.tar.gz -C /tmp
  JDK_X64=""
  for d in /tmp/jdk-21*; do [ -d "$d/Contents/Home/bin" ] && JDK_X64="$d/Contents/Home" && break; done
  if [ -z "$JDK_X64" ]; then
    warn "Could not find x86_64 JDK — x86_64 build will be skipped"
  else
    log "Building x86_64 JRE via $JDK_X64..."
    "$JDK_X64/bin/jlink" \
      --module-path "$JDK_X64/jmods" \
      --add-modules java.base,java.sql,jdk.crypto.ec,java.management \
      --output "$JRE_X64" \
      --strip-debug --compress=2 --no-header-files --no-man-pages
    success "x86_64 JRE built"
  fi
else
  log "x86_64 JRE already exists at $JRE_X64"
fi

# ── Step 3: Build universal server binary ─────────────────────────────────
log "Building server binary (ARM64 + x86_64 → universal)..."
bun build --compile --target=bun-darwin-arm64 server/index.ts \
  --outfile /tmp/rexadb-server-arm64
bun build --compile --target=bun-darwin-x64 server/index.ts \
  --outfile /tmp/rexadb-server-x64
lipo -create /tmp/rexadb-server-arm64 /tmp/rexadb-server-x64 \
  -output "src-tauri/binaries/rexadb-server-aarch64-apple-darwin"
cp "src-tauri/binaries/rexadb-server-aarch64-apple-darwin" \
   "src-tauri/binaries/rexadb-server-x86_64-apple-darwin"
rm -f /tmp/rexadb-server-arm64 /tmp/rexadb-server-x64
success "Universal server binary created"

# ── Step 4: Build frontend ────────────────────────────────────────────────
log "Building Next.js frontend..."
bun run build
success "Frontend built"

# ── Step 5: Build ARM64 .dmg ──────────────────────────────────────────────
log "Building ARM64 Tauri app..."
rm -rf "$BRIDGE_DIR/jre"
cp -a "$JRE_ARM64" "$BRIDGE_DIR/jre"
# Ensure JRE files are writable so xattr -cr doesn't fail during bundling
chmod -R u+w "$BRIDGE_DIR/jre"
bun run tauri build --bundles dmg
DMG_ARM64=$(find src-tauri/target -name "RexaDB_${VERSION}_aarch64.dmg" -type f 2>/dev/null | head -1)
if [ -z "$DMG_ARM64" ]; then
  DMG_ARM64=$(find src-tauri/target -name "*.dmg" -type f 2>/dev/null | head -1)
fi
if [ -z "$DMG_ARM64" ]; then
  fail "ARM64 .dmg not found"
fi
success "ARM64 .dmg: $DMG_ARM64"

# ── Step 6: Build x86_64 .dmg (if JRE available) ──────────────────────────
DMG_X64=""
if [ -d "$JRE_X64" ]; then
  log "Building x86_64 Tauri app (cross-compile)..."
  rm -rf "$BRIDGE_DIR/jre"
  cp -a "$JRE_X64" "$BRIDGE_DIR/jre"
  chmod -R u+w "$BRIDGE_DIR/jre"
  # cargo builds to target/x86_64-apple-darwin/release/ but tauri's bundler
  # always looks in target/release/, so we build manually then bundle
  cargo build --release --target x86_64-apple-darwin --manifest-path src-tauri/Cargo.toml
  cp src-tauri/target/x86_64-apple-darwin/release/rexa-db src-tauri/target/release/rexa-db
  BINARY_ARCH=$(file src-tauri/target/release/rexa-db 2>/dev/null | grep -oE "x86_64|arm64" | head -1)
  if [ "$BINARY_ARCH" != "x86_64" ]; then
    fail "Copied binary architecture is ${BINARY_ARCH:-unknown}, expected x86_64"
  fi
  bun run tauri bundle --bundles dmg
  # Tauri always names DMG as aarch64 on Apple Silicon hosts; rename for x86_64
  if [ -f "src-tauri/target/release/bundle/dmg/RexaDB_${VERSION}_aarch64.dmg" ]; then
    mv "src-tauri/target/release/bundle/dmg/RexaDB_${VERSION}_aarch64.dmg" \
       "src-tauri/target/release/bundle/dmg/RexaDB_${VERSION}_x86_64.dmg"
  fi
  DMG_X64=$(find src-tauri/target -name "RexaDB_${VERSION}_x86_64.dmg" -type f 2>/dev/null | head -1)
  if [ -z "$DMG_X64" ]; then
    warn "x86_64 .dmg not found — checking for any .dmg in cross-compile output..."
    DMG_X64=$(find src-tauri/target -name "*.dmg" -type f 2>/dev/null | head -1) || true
  fi
  if [ -n "${DMG_X64:-}" ] && [ -f "$DMG_X64" ]; then
    success "x86_64 .dmg: $DMG_X64"
  else
    warn "x86_64 .dmg build may have failed — check manually"
  fi
else
  warn "Skipping x86_64 build (no x86_64 JRE)"
fi

# ── Step 7: Restore ARM64 JRE ─────────────────────────────────────────────
rm -rf "$BRIDGE_DIR/jre"
cp -a "$JRE_ARM64" "$BRIDGE_DIR/jre"
log "Restored ARM64 JRE as default"

# ── Step 7b: Sign and upload macOS artifacts to draft release ──────────────
TAG="v${VERSION}"
log "Signing macOS DMGs and uploading to ${TAG} on rexadbapp/rexadb-app..."

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  warn "TAURI_SIGNING_PRIVATE_KEY not set — skipping signing and upload"
  log "Upload DMGs + generate platform snippets manually after build"
else
  KEY_FILE="/tmp/rexadb-sign-key"
  printf '%s' "$TAURI_SIGNING_PRIVATE_KEY" > "$KEY_FILE"
  KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  SIGNER="$ROOT/node_modules/.bin/tauri"
  # Use env var for key path (the -k flag doesn't handle base64-encoded keys)
  OLD_KEY_CONTENT="${TAURI_SIGNING_PRIVATE_KEY:-}"
  unset TAURI_SIGNING_PRIVATE_KEY
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_FILE"

  for pair in "${DMG_ARM64}:darwin-aarch64" "${DMG_X64}:darwin-x86_64"; do
    dmg="${pair%%:*}"
    target="${pair#*:}"
    [ -z "$dmg" ] || [ ! -f "$dmg" ] && continue

    sig_file="${dmg}.sig"
    snippet="src-tauri/target/release/platform.${target}.json"

    "$SIGNER" signer sign -p "$KEY_PASSWORD" "$dmg"
    success "Signed ${dmg##*/} (${target})"

    signature=$(cat "$sig_file")
    pub_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    url="https://github.com/rexadbapp/rexadb-app/releases/download/${TAG}/${dmg##*/}"
    printf '{\n  "version": "%s",\n  "pub_date": "%s",\n  "platforms": {\n    "%s": {\n      "url": "%s",\n      "signature": "%s"\n    }\n  }\n}\n' \
      "$VERSION" "$pub_date" "$target" "$url" "$signature" > "$snippet"
    success "Generated ${snippet##*/}"

    if gh release upload "$TAG" --repo rexadbapp/rexadb-app --clobber \
      "$dmg" "$sig_file" "$snippet" 2>&1; then
      success "Uploaded ${dmg##*/} to draft release"
    else
      warn "Upload failed — creating draft release..."
      gh release create "$TAG" --repo rexadbapp/rexadb-app \
        --title "RexaDB ${TAG}" --draft --generate-notes 2>&1 || true
      gh release upload "$TAG" --repo rexadbapp/rexadb-app --clobber \
        "$dmg" "$sig_file" "$snippet" 2>&1 && success "Uploaded ${dmg##*/}" || warn "Upload failed"
    fi
  done

  # Restore env vars
  export TAURI_SIGNING_PRIVATE_KEY="$OLD_KEY_CONTENT"
  unset TAURI_SIGNING_PRIVATE_KEY_PATH
  rm -f "$KEY_FILE"
fi

log ""
success "${BOLD}macOS release build complete!${NC}"
echo ""
echo "  Artifacts:"
echo "    - ARM64:  ${DMG_ARM64:-not built}"
echo "    - x86_64: ${DMG_X64:-not built}"
echo ""
echo "  Next steps:"
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "    1. macOS DMGs + platform snippets uploaded to draft release"
else
  echo "    1. Upload macOS DMGs + snippets manually: gh release upload ${TAG} --repo rexadbapp/rexadb-app --clobber <files>"
fi
echo "    2. Push tag v${VERSION} (if not already done) to trigger CI for Windows + Linux"
echo "    3. Run: ./scripts/finalize-release.sh v${VERSION}"
# ── Step 8: Auto-set GitHub secrets for CI ────────────────────────────────
REPO="rexadbapp/rexadb"
log "Setting GitHub Actions secrets on ${REPO}..."
SECRETS_SET=0
gh secret set APPLE_ID --repo "$REPO" --body "$APPLE_ID" 2>/dev/null && { success "APPLE_ID set"; SECRETS_SET=$((SECRETS_SET + 1)); } || warn "Failed to set APPLE_ID"
gh secret set APPLE_PASSWORD --repo "$REPO" --body "$APPLE_PASSWORD" 2>/dev/null && { success "APPLE_PASSWORD set"; SECRETS_SET=$((SECRETS_SET + 1)); } || warn "Failed to set APPLE_PASSWORD"
gh secret set APPLE_TEAM_ID --repo "$REPO" --body "$APPLE_TEAM_ID" 2>/dev/null && { success "APPLE_TEAM_ID set"; SECRETS_SET=$((SECRETS_SET + 1)); } || warn "Failed to set APPLE_TEAM_ID"
if [ "$SECRETS_SET" -gt 0 ]; then
  success "GitHub secrets set (${SECRETS_SET}/3)"
fi

log ""
echo "  Commands to push tag v${VERSION} and trigger CI:"
echo "    git add -u && git commit -m 'v${VERSION}' && git tag v${VERSION} && git push && git push origin v${VERSION}"
echo ""
echo "  CI will build:"
echo "    - Linux: .deb + .AppImage (with JRE)"
echo "    - Windows: .exe (with JRE)"
echo ""
