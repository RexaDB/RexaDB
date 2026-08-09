#!/usr/bin/env bash
# upload-missing.sh — Upload local build artifacts missing from an existing GitHub release.
#
# Usage:
#   ./scripts/upload-missing.sh [vX.Y.Z]
#
# If no version is given, it reads the version from dist/releases-*.sql

set -euo pipefail

GITHUB_REPO="rexadbapp/rexadb-app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"

RELEASE_TAG="${1:-}"
if [[ -z "$RELEASE_TAG" ]]; then
  SQL_FILE=$(ls "$DIST_DIR"/releases-*.sql 2>/dev/null | head -1)
  if [[ -n "$SQL_FILE" ]]; then
    v=$(basename "$SQL_FILE" .sql | sed 's/^releases-/v/')
    RELEASE_TAG="$v"
  else
    echo "Usage: $0 [vX.Y.Z]"
    exit 1
  fi
fi

echo "Release tag: $RELEASE_TAG"
echo ""

# ── Collect local artifacts (same logic as build-all.sh) ──
RAW_ARTIFACTS=()
while IFS= read -r -d '' f; do
  RAW_ARTIFACTS+=("$f")
done < <(find "$DIST_DIR" -maxdepth 2 \
  \( -name "*.dmg" -o -name "*.zip" -o -name "*.AppImage" -o -name "*.exe" -o -name "*.deb" -o -name "*.yml" -o -name "*.blockmap" \) \
  ! -name "builder-debug.yml" \
  -type f -print0 2>/dev/null)

# Deduplicate by filename (same logic as build-all.sh)
LOCAL_MAP=$(
  for f in "${RAW_ARTIFACTS[@]+"${RAW_ARTIFACTS[@]}"}"; do
    echo "$(basename "$f")|$f"
  done | sort -t'|' -k1,1 -u
)

LOCAL_COUNT=0
LOCAL_NAMES=()
LOCAL_PATHS=()
while IFS='|' read -r fname fpath; do
  if [[ -n "$fpath" ]]; then
    LOCAL_NAMES[$LOCAL_COUNT]="$fname"
    LOCAL_PATHS[$LOCAL_COUNT]="$fpath"
    LOCAL_COUNT=$((LOCAL_COUNT + 1))
  fi
done <<< "$LOCAL_MAP"

echo "Local artifacts found: $LOCAL_COUNT"

# ── Fetch remote assets ──
REMOTE_NAMES=$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPO" --json assets --jq '.assets[].name' 2>/dev/null || true)

echo "Remote artifacts on GitHub: $(echo "$REMOTE_NAMES" | grep -c . || echo 0)"
echo ""

# ── Compute and upload missing ──
MISSING_NAMES=()
MISSING_PATHS=()
MISSING_COUNT=0
i=0
while [[ $i -lt $LOCAL_COUNT ]]; do
  fname="${LOCAL_NAMES[$i]}"
  if ! echo "$REMOTE_NAMES" | grep -qxF "$fname"; then
    MISSING_NAMES[$MISSING_COUNT]="$fname"
    MISSING_PATHS[$MISSING_COUNT]="${LOCAL_PATHS[$i]}"
    MISSING_COUNT=$((MISSING_COUNT + 1))
  fi
  i=$((i + 1))
done

if [[ $MISSING_COUNT -eq 0 ]]; then
  echo "All artifacts already uploaded. Nothing to do."
  exit 0
fi

echo "Uploading $MISSING_COUNT missing artifact(s)..."
echo ""

success_count=0
i=0
while [[ $i -lt $MISSING_COUNT ]]; do
  f="${MISSING_PATHS[$i]}"
  fname="${MISSING_NAMES[$i]}"
  size=$(du -h "$f" | cut -f1)
  echo "  Uploading $fname ($size)..."
  if gh release upload "$RELEASE_TAG" "$f" --repo "$GITHUB_REPO" --clobber; then
    echo "    ✓ Uploaded"
    success_count=$((success_count + 1))
  else
    echo "    ✗ Failed"
  fi
  i=$((i + 1))
done

echo ""
echo "Uploaded $success_count / $MISSING_COUNT artifact(s)."
echo "Release: https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}"
