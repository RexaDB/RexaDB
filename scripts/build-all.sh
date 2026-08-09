#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build-all.sh — Multi-platform build script for Rexa DB
#
# Usage:
#   ./scripts/build-all.sh              # Build ALL platforms
#   ./scripts/build-all.sh mac-arm      # macOS Apple Silicon (arm64) only
#   ./scripts/build-all.sh mac-intel    # macOS Intel (x64) only
#   ./scripts/build-all.sh mac          # Both macOS builds (arm64 + x64)
#   ./scripts/build-all.sh linux        # Linux x64 only
#   ./scripts/build-all.sh win          # Windows x64 only
#
# You can combine targets:
#   ./scripts/build-all.sh mac-arm linux win
#
# Options:
#   --skip-nextbuild   Skip the Next.js build step (use existing .next)
#   --publish never    Pass publish flag to electron-builder (default: never)
#   --file-url-base    Base URL for file_url in SQL (default: placeholder)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Project root (always relative to this script) ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DIST_DIR="$PROJECT_ROOT/dist"
PUBLISH="never"
SKIP_NEXT_BUILD=false
FILE_URL_BASE="https://YOUR_STORAGE_URL/releases"
GITHUB_RELEASE=false
GITHUB_REPO="rexadbapp/rexadb-app"

# ── Version handling ──────────────────────────────────────────────────────────
# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Get latest release tag from GitHub and increment version
if [[ "$GITHUB_RELEASE" == true ]]; then
  log "Fetching latest release from GitHub..."
  LATEST_TAG=$(gh release list --repo "$GITHUB_REPO" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null || echo "")

  if [[ -n "$LATEST_TAG" ]]; then
    # Remove 'v' prefix if present
    LATEST_VERSION="${LATEST_TAG#v}"
    # Parse version and increment patch
    IFS='.' read -r MAJOR MINOR PATCH <<< "$LATEST_VERSION"
    PATCH=$((PATCH + 1))
    APP_VERSION="${MAJOR}.${MINOR}.${PATCH}"
    log "Latest release: ${LATEST_TAG}, new version: ${APP_VERSION}"
  else
    # No releases yet, use current version
    APP_VERSION="$CURRENT_VERSION"
    log "No previous releases found, using current version: ${APP_VERSION}"
  fi

  # Update version in package.json
  node -e "const pkg = require('./package.json'); pkg.version = '$APP_VERSION'; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');"
  log "Updated package.json to version ${APP_VERSION}"
else
  APP_VERSION="$CURRENT_VERSION"
fi

# ── Parse arguments ─────────────────────────────────────────────────────────
TARGETS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-nextbuild)  SKIP_NEXT_BUILD=true; shift ;;
    --publish)         PUBLISH="$2"; shift 2 ;;
    --file-url-base)   FILE_URL_BASE="$2"; shift 2 ;;
    --github-release)  GITHUB_RELEASE=true; shift ;;
    mac-arm|mac-arm64) TARGETS+=("mac-arm64"); shift ;;
    mac-intel|mac-x64) TARGETS+=("mac-x64"); shift ;;
    mac|macos)         TARGETS+=("mac-arm64" "mac-x64"); shift ;;
    linux)             TARGETS+=("linux-x64"); shift ;;
    win|windows)       TARGETS+=("win-x64"); shift ;;
    all)               TARGETS=("mac-arm64" "mac-x64" "linux-x64" "win-x64"); shift ;;
    *)                 echo -e "${RED}Unknown argument: $1${NC}"; exit 1 ;;
  esac
done

# Default: build everything
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("mac-arm64" "mac-x64" "linux-x64" "win-x64")
fi

# Deduplicate
TARGETS=($(printf '%s\n' "${TARGETS[@]}" | sort -u))

# ── Helpers ──────────────────────────────────────────────────────────────────
log()     { echo -e "${BLUE}[build]${NC} $*"; }
success() { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
warn()    { echo -e "${YELLOW}[ warn]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL ]${NC} $*"; }

separator() {
  echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
}

elapsed() {
  local secs=$1
  printf '%dm %ds' $((secs / 60)) $((secs % 60))
}

# Track results for final summary (parallel arrays — Bash 3 compatible)
RESULT_TARGETS=()
RESULT_STATUSES=()
RESULT_TIMES=()

# ── Preflight checks ────────────────────────────────────────────────────────
separator
log "${BOLD}Rexa DB — Multi-Platform Build${NC}"
separator

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Please install Node.js >= 18."
  exit 1
fi

if ! command -v npm &>/dev/null; then
  fail "npm is not found."
  exit 1
fi

NODE_VERSION=$(node -v)
log "Node.js ${NODE_VERSION}"
log "npm $(npm -v)"
log "Platform: $(uname -s) $(uname -m)"
log "Version: ${APP_VERSION}"
log "Targets: ${TARGETS[*]}"
echo ""

# ── Preflight checks for GitHub CLI ──────────────────────────────────────────
if [[ "$GITHUB_RELEASE" == true ]]; then
  if ! command -v gh &>/dev/null; then
    fail "gh CLI is not installed. Please install GitHub CLI to use --github-release."
    exit 1
  fi
  if ! gh auth status &>/dev/null; then
    fail "gh CLI is not authenticated. Please run 'gh auth login'."
    exit 1
  fi
fi

# ── Clean previous builds ──────────────────────────────────────────────────
log "Cleaning dist/ from previous builds..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
success "dist/ cleaned"

# ── Step 1: Install dependencies ────────────────────────────────────────────
if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  log "Installing dependencies..."
  npm install
  success "Dependencies installed"
else
  log "node_modules found, skipping npm install"
fi

# ── Step 2: Build Next.js ────────────────────────────────────────────────────
if [[ "$SKIP_NEXT_BUILD" == true ]]; then
  warn "Skipping Next.js build (--skip-nextbuild)"
else
  separator
  log "${BOLD}Building Next.js app...${NC}"
  NEXT_START=$(date +%s)

  npm run build

  NEXT_END=$(date +%s)
  success "Build complete ($(elapsed $((NEXT_END - NEXT_START))))"
fi

# ── Step 3: Build Electron for each target ───────────────────────────────────
separator
log "${BOLD}Building Electron distributables...${NC}"
echo ""

build_target() {
  local target="$1"
  local eb_platform eb_args
  local start_time end_time

  case "$target" in
    mac-arm64)
      eb_platform="--mac"
      eb_args="--arm64"
      ;;
    mac-x64)
      eb_platform="--mac"
      eb_args="--x64"
      ;;
    linux-x64)
      eb_platform="--linux"
      eb_args="--x64"
      ;;
    win-x64)
      eb_platform="--win"
      eb_args="--x64"
      ;;
    *)
      fail "Unknown target: $target"
      RESULT_TARGETS+=("$target")
      RESULT_STATUSES+=("FAIL")
      RESULT_TIMES+=("0")
      return 1
      ;;
  esac

  separator
  log "${BOLD}Building: ${CYAN}$target${NC}"

  start_time=$(date +%s)

  # Run electron-builder
  if npx electron-builder \
    $eb_platform \
    $eb_args \
    --publish "$PUBLISH" \
    --config.directories.output="dist/$target" \
    2>&1 | while IFS= read -r line; do echo -e "  ${line}"; done; then
    end_time=$(date +%s)
    RESULT_TARGETS+=("$target")
    RESULT_STATUSES+=("OK")
    RESULT_TIMES+=("$((end_time - start_time))")
    success "$target built in $(elapsed $((end_time - start_time)))"
  else
    end_time=$(date +%s)
    RESULT_TARGETS+=("$target")
    RESULT_STATUSES+=("FAIL")
    RESULT_TIMES+=("$((end_time - start_time))")
    fail "$target build failed after $(elapsed $((end_time - start_time)))"
  fi

  echo ""
}

for target in "${TARGETS[@]}"; do
  build_target "$target" || true
done

# ── Step 4: Generate releases SQL ────────────────────────────────────────────
separator
log "${BOLD}Generating releases SQL...${NC}"

SQL_FILE="$DIST_DIR/releases-${APP_VERSION}.sql"
mkdir -p "$DIST_DIR"

cat > "$SQL_FILE" <<HEADER
-- ──────────────────────────────────────────────────────────────
-- Rexa DB v${APP_VERSION} — Release inserts
-- Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
-- ──────────────────────────────────────────────────────────────

HEADER

SQL_COUNT=0

# Find the distributable artifact for each successfully built target
for i in $(seq 0 $((${#RESULT_TARGETS[@]} - 1))); do
  target="${RESULT_TARGETS[$i]}"
  status="${RESULT_STATUSES[$i]}"

  if [[ "$status" != "OK" ]]; then
    echo "-- Skipped $target (build failed)" >> "$SQL_FILE"
    continue
  fi

  target_dir="$DIST_DIR/$target"
  if [[ ! -d "$target_dir" ]]; then
    echo "-- Skipped $target (output directory missing)" >> "$SQL_FILE"
    continue
  fi

  # Determine the platform string for the releases table
  release_platform="$target"

  # Find the main distributable file
  artifact=""
  case "$target" in
    mac-*)
      # Prefer .dmg, fall back to .zip
      artifact=$(find "$target_dir" -maxdepth 1 -name "*.dmg" 2>/dev/null | head -1)
      if [[ -z "$artifact" ]]; then
        artifact=$(find "$target_dir" -maxdepth 1 -name "*.zip" 2>/dev/null | head -1)
      fi
      ;;
    linux-*)
      artifact=$(find "$target_dir" -maxdepth 1 -name "*.AppImage" 2>/dev/null | head -1)
      if [[ -z "$artifact" ]]; then
        artifact=$(find "$target_dir" -maxdepth 1 -name "*.deb" 2>/dev/null | head -1)
      fi
      ;;
    win-*)
      artifact=$(find "$target_dir" -maxdepth 1 -name "*.exe" 2>/dev/null | head -1)
      ;;
  esac

  if [[ -z "$artifact" ]]; then
    echo "-- Skipped $target (no distributable artifact found)" >> "$SQL_FILE"
    warn "No artifact found for $target"
    continue
  fi

  artifact_name=$(basename "$artifact")
  artifact_size=$(wc -c < "$artifact" | tr -d ' ')

  # Compute SHA-512
  if command -v shasum &>/dev/null; then
    artifact_sha512=$(shasum -a 512 "$artifact" | awk '{print $1}')
  elif command -v sha512sum &>/dev/null; then
    artifact_sha512=$(sha512sum "$artifact" | awk '{print $1}')
  else
    artifact_sha512="COMPUTE_SHA512_MANUALLY"
    warn "Neither shasum nor sha512sum found — SHA-512 not computed for $target"
  fi

  file_url="${FILE_URL_BASE}/${APP_VERSION}/${artifact_name}"

  cat >> "$SQL_FILE" <<SQL
INSERT INTO public.releases (version, channel, platform, file_url, sha512, size)
VALUES (
  '${APP_VERSION}',
  'stable',
  '${release_platform}',
  '${file_url}',
  '${artifact_sha512}',
  ${artifact_size}
);

SQL

  SQL_COUNT=$((SQL_COUNT + 1))
  log "  ${GREEN}✓${NC} ${target}: ${artifact_name} ($(du -h "$artifact" | cut -f1 | tr -d ' '))"
done

echo ""

if [[ $SQL_COUNT -gt 0 ]]; then
  success "Generated ${SQL_COUNT} INSERT statement(s) → ${CYAN}dist/releases-${APP_VERSION}.sql${NC}"
else
  warn "No SQL statements generated (no successful builds with artifacts)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
separator
echo ""
log "${BOLD}Build Summary${NC}"
echo ""

printf "  ${BOLD}%-16s %-10s %s${NC}\n" "TARGET" "STATUS" "TIME"
printf "  %-16s %-10s %s\n" "────────────────" "──────────" "────────"

all_ok=true
for i in $(seq 0 $((${#RESULT_TARGETS[@]} - 1))); do
  target="${RESULT_TARGETS[$i]}"
  status="${RESULT_STATUSES[$i]}"
  time_taken="${RESULT_TIMES[$i]}"

  if [[ "$status" == "OK" ]]; then
    status_colored="${GREEN}✓ OK${NC}"
  else
    status_colored="${RED}✗ FAIL${NC}"
    all_ok=false
  fi

  printf "  %-16s ${status_colored}%-6s %s\n" "$target" "" "$(elapsed "$time_taken")"
done

echo ""

if [[ "$all_ok" == true ]]; then
  success "${BOLD}All builds completed successfully!${NC}"
  echo ""
  log "Output directory: ${CYAN}$DIST_DIR${NC}"
  echo ""
  log "Artifacts:"
  for target in "${TARGETS[@]}"; do
    if [[ -d "$DIST_DIR/$target" ]]; then
      echo -e "  ${CYAN}dist/$target/${NC}"
      find "$DIST_DIR/$target" \
        \( -name "*.dmg" -o -name "*.zip" -o -name "*.AppImage" -o -name "*.exe" -o -name "*.deb" -o -name "*.rpm" \) \
        ! -name "builder-debug.yml" \
        -maxdepth 1 2>/dev/null | while IFS= read -r f; do
          size=$(du -h "$f" | cut -f1)
          echo -e "    $(basename "$f") ${YELLOW}($size)${NC}"
        done
    fi
  done
  echo ""
  log "SQL file: ${CYAN}dist/releases-${APP_VERSION}.sql${NC}"
else
  fail "${BOLD}Some builds failed. Check the output above for details.${NC}"
  exit 1
fi

echo ""

# ── Step 5: Create GitHub Release (if enabled) ─────────────────────────
if [[ "$GITHUB_RELEASE" == true ]] && [[ "$all_ok" == true ]]; then
  separator
  log "${BOLD}Creating GitHub Release...${NC}"
  echo ""

  RELEASE_TAG="v${APP_VERSION}"
  RELEASE_TITLE="Rexa DB v${APP_VERSION}"

  # Collect all build artifacts (including auto-update files)
  RAW_ARTIFACTS=()
  while IFS= read -r -d '' f; do
    RAW_ARTIFACTS+=("$f")
  done < <(find "$DIST_DIR" -maxdepth 2 \
    \( -name "*.dmg" -o -name "*.zip" -o -name "*.AppImage" -o -name "*.exe" -o -name "*.deb" -o -name "*.yml" -o -name "*.blockmap" \) \
    ! -name "builder-debug.yml" \
    -type f -print0 2>/dev/null)

  # Deduplicate by filename to avoid redundant uploads when targets overlap
  ARTIFACTS=()
  while IFS='|' read -r fname fpath; do
    [[ -n "$fpath" ]] && ARTIFACTS+=("$fpath")
  done < <(for f in "${RAW_ARTIFACTS[@]}"; do echo "$(basename "$f")|$f"; done | sort -t'|' -k1,1 -u)

  if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
    warn "No artifacts found to upload"
  else
    log "Preparing to release ${#ARTIFACTS[@]} unique artifact(s)..."
    echo ""

    # Show file sizes
    for f in "${ARTIFACTS[@]}"; do
      size=$(du -h "$f" | cut -f1)
      echo -e "  ${CYAN}$(basename "$f")${NC} (${YELLOW}${size}${NC})"
    done
    echo ""

    # Create release with --generate-notes and upload artifacts
    # gh CLI shows upload progress by default
    log "Preparing GitHub release..."

    # Check if release already exists and delete it to ensure a clean state
    # This avoids issues with ghost assets or draft states that cause 404/422 errors
    if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPO" &>/dev/null; then
      log "Release ${RELEASE_TAG} already exists. Deleting it to ensure a clean state..."
      # Delete the release, but keep the tag if it already exists
      gh release delete "$RELEASE_TAG" --repo "$GITHUB_REPO" --yes 2>/dev/null || true
    fi

    log "Creating new release ${RELEASE_TAG} (Published)..."
    if ! gh release create "$RELEASE_TAG" \
      --repo "$GITHUB_REPO" \
      --title "$RELEASE_TITLE" \
      --generate-notes \
      --latest; then
      fail "Failed to create GitHub release"
      exit 1
    fi

    # Small delay to ensure GitHub's API is ready for uploads
    sleep 2

    log "Uploading ${#ARTIFACTS[@]} artifact(s) to GitHub... (this may take several minutes)"
    echo ""

    success_count=0
    for f in "${ARTIFACTS[@]}"; do
      fname=$(basename "$f")
      log "  Uploading ${CYAN}${fname}${NC}..."
      
      # Try uploading with up to 3 retries
      retry_count=0
      max_retries=3
      while [[ $retry_count -lt $max_retries ]]; do
        if gh release upload "$RELEASE_TAG" "$f" \
          --repo "$GITHUB_REPO" \
          --clobber >/dev/null 2>&1; then
          success_count=$((success_count + 1))
          log "    ${GREEN}✓${NC} Uploaded"
          break
        else
          retry_count=$((retry_count + 1))
          if [[ $retry_count -lt $max_retries ]]; then
            warn "    Upload failed, retrying ($retry_count/$max_retries)..."
            sleep 3
          else
            fail "    Failed to upload ${fname} after ${max_retries} attempts."
          fi
        fi
      done
    done

    if [[ $success_count -eq ${#ARTIFACTS[@]} ]]; then
      echo ""
      success "All ${success_count} artifacts uploaded successfully!"
      log "Release URL: https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}"
    else
      echo ""
      fail "Only ${success_count} of ${#ARTIFACTS[@]} artifacts were uploaded successfully."
      exit 1
    fi
  fi
fi

separator
