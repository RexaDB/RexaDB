#!/usr/bin/env bash
set -euo pipefail

RELEASE_REPO="rexadbapp/rexadb-app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}[finalize]${NC} $*"; }
success() { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn ]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL ]${NC} $*"; }

RELEASE_TAG="${1:-}"
if [ -z "$RELEASE_TAG" ]; then
  RELEASE_TAG="v$(node -p "require('./src-tauri/tauri.conf.json').version")"
fi

log "${BOLD}Finalizing release ${RELEASE_TAG}${NC}"
echo ""

if ! gh auth status &>/dev/null; then
  fail "gh CLI not authenticated"
  exit 1
fi

echo ""
log "Checking CI status for tag ${RELEASE_TAG}..."
# Get the latest run for this tag
RUN_DATA=$(gh run list --repo rexadbapp/rexadb \
  --workflow "Build (Windows & Linux)" \
  --branch "$RELEASE_TAG" \
  --json databaseId,status,conclusion --jq '.[0]' 2>/dev/null || echo "null")

if [ "$RUN_DATA" = "null" ] || [ -z "$RUN_DATA" ]; then
  warn "No CI runs found for tag ${RELEASE_TAG}"
else
  RUN_ID=$(echo "$RUN_DATA" | jq -r '.databaseId')
  STATUS=$(echo "$RUN_DATA" | jq -r '.status')
  CONCLUSION=$(echo "$RUN_DATA" | jq -r '.conclusion // "null"')

  if [ "$STATUS" != "completed" ]; then
    warn "CI run #${RUN_ID} is still in progress. Wait for it to finish."
    echo ""
    log "Check status: https://github.com/rexadbapp/rexadb/actions"
    echo ""
  elif [ "$CONCLUSION" != "success" ]; then
    fail "CI run #${RUN_ID} finished with status: ${CONCLUSION}"
    exit 1
  else
    success "CI run #${RUN_ID} completed successfully"
  fi

  log "Fetching release artifacts from CI run #${RUN_ID}..."
  TMPDIR=$(mktemp -d)
  gh run download --repo rexadbapp/rexadb --run-id "$RUN_ID" \
    --name "RexaDB-Linux-x64" --dir "$TMPDIR/linux" 2>/dev/null || true
  gh run download --repo rexadbapp/rexadb --run-id "$RUN_ID" \
    --name "RexaDB-Windows-x64" --dir "$TMPDIR/win" 2>/dev/null || true

  LINUX_FILES=()
  WIN_FILES=()
  if [ -d "$TMPDIR/linux" ]; then
    while IFS= read -r f; do LINUX_FILES+=("$f"); done < <(find "$TMPDIR/linux" -type f \( -name "*.deb" -o -name "*.AppImage" -o -name "*.sig" -o -name "*.json" \) 2>/dev/null)
  fi
  if [ -d "$TMPDIR/win" ]; then
    while IFS= read -r f; do WIN_FILES+=("$f"); done < <(find "$TMPDIR/win" -type f \( -name "*.exe" -o -name "*.msi" -o -name "*.sig" -o -name "*.json" \) 2>/dev/null)
  fi

  if [ ${#LINUX_FILES[@]} -gt 0 ] || [ ${#WIN_FILES[@]} -gt 0 ]; then
    log "Uploading CI artifacts to release..."
    UPLOAD=()
    UPLOAD+=("${LINUX_FILES[@]}")
    UPLOAD+=("${WIN_FILES[@]}")
    gh release upload "$RELEASE_TAG" --repo "$RELEASE_REPO" --clobber "${UPLOAD[@]}" 2>&1 | while IFS= read -r line; do echo "  $line"; done
    success "CI artifacts uploaded"
  else
    log "No CI artifacts found — they may already be uploaded by the CI workflow"
  fi

  rm -rf "$TMPDIR"
fi

echo ""
log "Generating combined latest.json from platform snippets..."
SNIPPETS_DIR=$(mktemp -d)
cd "$SNIPPETS_DIR"
gh release download "$RELEASE_TAG" --repo "$RELEASE_REPO" --pattern "platform.*.json" 2>/dev/null || true

if ls platform.*.json 1>/dev/null 2>&1; then
  echo "Found snippets:"
  ls -la platform.*.json
  jq -s '{
    version: .[0].version,
    pub_date: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
    notes: "",
    platforms: ([.[].platforms] | add)
  }' platform.*.json > latest.json
  echo "Merged latest.json:"
  cat latest.json
  gh release upload "$RELEASE_TAG" --repo "$RELEASE_REPO" --clobber latest.json
  success "latest.json generated and uploaded"
else
  warn "No platform.*.json snippets found on release"
  echo "Release assets:"
  gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" --json assets -q '.assets[].name' 2>/dev/null || echo "(could not list)"
fi

cd "$PROJECT_ROOT"
rm -rf "$SNIPPETS_DIR"

echo ""
log "Release ${RELEASE_TAG} on ${RELEASE_REPO}:"
echo "  https://github.com/${RELEASE_REPO}/releases/tag/${RELEASE_TAG}"
echo ""

read -p "Publish the draft release? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  gh release edit "$RELEASE_TAG" --repo "$RELEASE_REPO" --draft=false
  success "Release published!"
else
  log "Draft left unpublished. Publish manually when ready."
fi
