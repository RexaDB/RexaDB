#!/usr/bin/env bash
set -euo pipefail

RELEASE_REPO="rexadbapp/rexadb-app"
SOURCE_REPO="rexadbapp/rexadb"
KEY_FILE="$HOME/.tauri/rexadb-updater.key"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}[release]${NC} $*"; }
success() { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL ]${NC} $*"; }

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
RELEASE_TAG="v${VERSION}"

log "${BOLD}RexaDB macOS Release v${VERSION}${NC}"
echo ""

if ! gh auth status &>/dev/null; then
  fail "gh CLI not authenticated. Run: gh auth login"
  exit 1
fi

if [ ! -f "$KEY_FILE" ]; then
  fail "Updater key not found at $KEY_FILE"
  exit 1
fi

if [ -z "${TAURI_KEY_PASSWORD:-}" ]; then
  echo -n "Enter updater key password: "
  read -s TAURI_KEY_PASSWORD
  echo ""
  export TAURI_KEY_PASSWORD
fi

log "Building server sidecar for aarch64..."
bun run scripts/build-server.mjs

log "Building server sidecar for x86_64..."
bun build --compile --target=bun-darwin-x64 \
  server/index.ts \
  --outfile=src-tauri/binaries/rexadb-server-x86_64-apple-darwin

success "Sidecars built"

for triple in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -q "$triple"; then
    fail "Missing Rust target: $triple — run: rustup target add $triple"
    exit 1
  fi
done

export TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_KEY_PASSWORD"

for triple in aarch64-apple-darwin x86_64-apple-darwin; do
  arch=${triple%%-*}
  [[ "$arch" == "aarch64" ]] && m_arch="aarch64" || m_arch="x86_64"

  log "Building for ${triple}..."

  bun run tauri build --target "$triple" --bundles "app,dmg"

  BUNDLE_DIR="src-tauri/target/${triple}/release/bundle"

  DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" | head -1)
  [ -z "$DMG" ] && fail "No .dmg for ${triple}" && exit 1

  UPDATER=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz" | head -1)
  [ -z "$UPDATER" ] && fail "No .tar.gz for ${triple}" && exit 1

  SIG=$(find "$BUNDLE_DIR/macos" -name "*.sig" | head -1)
  [ -z "$SIG" ] && fail "No .sig for ${triple}" && exit 1

  UPDATER_ARCH_NAME="RexaDB_${m_arch}.app.tar.gz"
  mv "$UPDATER" "$BUNDLE_DIR/macos/$UPDATER_ARCH_NAME"
  UPDATER="$BUNDLE_DIR/macos/$UPDATER_ARCH_NAME"

  SIG_ARCH_NAME="RexaDB_${m_arch}.app.tar.gz.sig"
  mv "$SIG" "$BUNDLE_DIR/macos/$SIG_ARCH_NAME"
  SIG="$BUNDLE_DIR/macos/$SIG_ARCH_NAME"

  SIGNATURE=$(cat "$SIG")
  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  PLATFORM_KEY="darwin-${m_arch}"
  SNIPPET="src-tauri/target/release/platform.${PLATFORM_KEY}.json"
  mkdir -p "src-tauri/target/release"
  UPDATER_URL="https://github.com/${RELEASE_REPO}/releases/download/${RELEASE_TAG}/${UPDATER##*/}"
  cat > "$SNIPPET" <<JSON
{
  "version": "${VERSION}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "${PLATFORM_KEY}": {
      "url": "${UPDATER_URL}",
      "signature": "${SIGNATURE}"
    }
  }
}
JSON
  echo "  Snippet:         ${SNIPPET##*/}"

  echo ""
  log "Artifacts for ${triple}:"
  echo "  DMG:             ${DMG##*/}"
  echo "  Updater bundle:  ${UPDATER##*/}"
  echo "  SIG:             ${SIG##*/}"
  echo "  Updater URL:     ${UPDATER_URL}"
  echo ""

  if [ "$arch" = "aarch64" ] && ! gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" &>/dev/null; then
    log "Creating draft release $RELEASE_TAG on $RELEASE_REPO..."
    gh release create "$RELEASE_TAG" \
      --repo "$RELEASE_REPO" \
      --title "RexaDB v${VERSION}" \
      --draft \
      --generate-notes
    success "Draft release created"
  fi

  log "Uploading ${triple} artifacts..."
  gh release upload "$RELEASE_TAG" --repo "$RELEASE_REPO" --clobber \
    "$DMG" "$UPDATER" "$SIG" "$SNIPPET"
  success "${triple} artifacts uploaded"
done

log "Pushing tag to trigger CI for Windows + Linux..."
git tag -f "$RELEASE_TAG" 2>/dev/null || git tag "$RELEASE_TAG"
git push origin "$RELEASE_TAG" --force
success "Tag $RELEASE_TAG pushed — CI building Windows + Linux"

echo ""
log "${BOLD}Next steps:${NC}"
echo "  1. CI is building Windows + Linux (~30 min)"
echo "  2. When CI finishes, run: ./scripts/finalize-release.sh v${VERSION}"
echo "  3. Release URL: https://github.com/${RELEASE_REPO}/releases/tag/${RELEASE_TAG}"
