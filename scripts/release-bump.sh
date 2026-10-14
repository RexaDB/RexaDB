#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# release-bump.sh — Automate the RexaDB version-bump release flow.
#
# Steps:
#   1. Refuse to run with dirty tracked files (commit or stash first)
#   2. Switch to master and fast-forward it from origin
#   3. Verify everything builds (Next.js + sidecar server) BEFORE bumping
#   4. Bump version in package.json + Tauri files + flake.nix
#        (src-tauri/tauri.conf.json, src-tauri/Cargo.toml,
#         src-tauri/Cargo.lock [rexa-db entry only], flake.nix [version only])
#   5. Commit ("chore: bump version to X.Y.Z") and create lightweight tag vX.Y.Z
#   6. Optionally push commit + tag with --push
#
# Usage:
#   ./scripts/release-bump.sh [version] [--push] [--no-verify] [--yes]
#
#   version        Explicit version (e.g. 1.3.23). If omitted, the patch
#                  component of master's package.json version is incremented.
#   --push         Push the bump commit and tag to origin after tagging.
#   --no-verify    Skip the pre-bump build verification (not recommended).
#   --yes, -y      Skip the confirmation prompt.
#   --help, -h     Show this help.
#
# Examples:
#   ./scripts/release-bump.sh               # auto-bump patch, no push
#   ./scripts/release-bump.sh 1.4.0 --push  # explicit version + push
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Project root (always relative to this script) ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Helpers ──────────────────────────────────────────────────────────────────
log()     { echo -e "${BLUE}[release]${NC} $*"; }
success() { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
warn()    { echo -e "${YELLOW}[ warn]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL ]${NC} $*" >&2; }

usage() { sed -n '2,/^# ─*$/p' "$0" | sed 's/^# \{0,1\}//'; }

# ── Parse arguments ──────────────────────────────────────────────────────────
REQUESTED_VERSION=""
PUSH=false
VERIFY=true
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --push) PUSH=true; shift ;;
    --no-verify) VERIFY=false; shift ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    --*) fail "Unknown option: $1 (see --help)"; exit 1 ;;
    *)
      if [[ -n "$REQUESTED_VERSION" ]]; then
        fail "Unexpected extra argument: $1 (see --help)"; exit 1
      fi
      REQUESTED_VERSION="$1"; shift ;;
  esac
done

# ── Preflight: required tools ────────────────────────────────────────────────
for cmd in git node bun; do
  if ! command -v "$cmd" &>/dev/null; then
    fail "'$cmd' is not installed or not on PATH."
    exit 1
  fi
done

# ── Preflight: clean tracked working tree ────────────────────────────────────
# (Untracked files are fine — they don't affect checkout/commit of version files.)
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Tracked files have uncommitted changes. Commit or stash them first:"
  git status --short | head -n 20 >&2
  exit 1
fi
success "Working tree clean (tracked files)"

# ── Step 1: switch to master, update from origin ─────────────────────────────
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "master" ]]; then
  log "Switching from '$CURRENT_BRANCH' to 'master'..."
  git checkout master
else
  log "Already on 'master'"
fi

log "Fetching from origin..."
git fetch origin

# Refuse to proceed if local master has diverged from origin/master.
BEHIND="$(git rev-list --count master..origin/master)"
AHEAD="$(git rev-list --count origin/master..master)"
if [[ "$AHEAD" -gt 0 && "$BEHIND" -gt 0 ]]; then
  fail "Local master has diverged from origin/master (ahead $AHEAD, behind $BEHIND). Resolve manually."
  exit 1
fi
if [[ "$AHEAD" -gt 0 ]]; then
  warn "Local master is $AHEAD commit(s) ahead of origin/master — proceeding (use --push to publish)."
fi
if [[ "$BEHIND" -gt 0 ]]; then
  log "Fast-forwarding master ($BEHIND commit(s) behind)..."
  git pull --ff-only origin master
  success "master is now at $(git rev-parse --short HEAD)"
else
  success "master is up to date with origin/master ($(git rev-parse --short HEAD))"
fi

# ── Step 2: resolve target version ───────────────────────────────────────────
CURRENT_VERSION="$(node -p "require('./package.json').version")"
if [[ -z "$REQUESTED_VERSION" ]]; then
  if ! [[ "$CURRENT_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    fail "Cannot auto-increment: package.json version '$CURRENT_VERSION' is not semver X.Y.Z. Pass a version explicitly."
    exit 1
  fi
  NEW_VERSION="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
  log "Auto-increment: $CURRENT_VERSION → $NEW_VERSION"
else
  if ! [[ "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "Invalid version '$REQUESTED_VERSION' — expected semver X.Y.Z (e.g. 1.3.23)."
    exit 1
  fi
  NEW_VERSION="$REQUESTED_VERSION"
fi

if [[ "$NEW_VERSION" == "$CURRENT_VERSION" ]]; then
  fail "Target version $NEW_VERSION is already the current version. Nothing to do."
  exit 1
fi

if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
  fail "Tag v${NEW_VERSION} already exists. Pick a different version."
  exit 1
fi

# ── Step 3: verify everything builds BEFORE bumping ──────────────────────────
if [[ "$VERIFY" == true ]]; then
  log "${BOLD}Verifying build (Next.js)...${NC}"
  bun run build
  success "Next.js build passed"

  log "${BOLD}Verifying build (sidecar server)...${NC}"
  bun run server:build
  success "Server build passed"
else
  warn "Skipping build verification (--no-verify)"
fi

# ── Step 4: confirm ──────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" != true ]]; then
  echo ""
  echo -e "  Bump ${BOLD}${CURRENT_VERSION}${NC} → ${BOLD}${GREEN}${NEW_VERSION}${NC} on ${BOLD}master${NC}$( [[ "$PUSH" == true ]] && echo " + push to origin" || echo " (no push)" )?"
  echo -e "  Files: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, flake.nix"
  read -r -p "  Continue? [y/N] " answer
  if ! [[ "$answer" =~ ^[Yy]$ ]]; then
    log "Aborted."
    exit 0
  fi
fi

# ── Step 5: bump version everywhere (incl. Tauri) ────────────────────────────
log "Bumping version to $NEW_VERSION..."

# Single-line, diff-minimal replacements (keeps formatting identical).
node -e "
const fs = require('fs');
const from = '$CURRENT_VERSION';
const to = '$NEW_VERSION';
const edits = [
  ['./package.json', '\"version\": \"' + from + '\"'],
  ['./src-tauri/tauri.conf.json', '\"version\": \"' + from + '\"'],
  ['./src-tauri/Cargo.toml', 'version = \"' + from + '\"'],
  ['./flake.nix', 'version = \"' + from + '\"'],
];
for (const [file, needle] of edits) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(needle)) {
    console.error('Expected version string not found in ' + file);
    process.exit(1);
  }
  fs.writeFileSync(file, content.replace(needle, needle.replace(from, to)));
  console.log('  updated ' + file);
}
// Cargo.lock: only the rexa-db package entry (identified by preceding name line).
const lockFile = './src-tauri/Cargo.lock';
let lock = fs.readFileSync(lockFile, 'utf8');
const lockNeedle = 'name = \"rexa-db\"\nversion = \"' + from + '\"';
if (!lock.includes(lockNeedle)) {
  console.error('rexa-db entry not found in ' + lockFile);
  process.exit(1);
}
lock = lock.replace(lockNeedle, 'name = \"rexa-db\"\nversion = \"' + to + '\"');
fs.writeFileSync(lockFile, lock);
console.log('  updated ' + lockFile);
"

# Sanity check: every version file must now read exactly NEW_VERSION, and the
# old version must be gone as a parsed field (substring grep would false-match
# 1.3.23 inside 1.3.230, so compare exact fields instead).
node -e "
const fs = require('fs');
const oldV = '$CURRENT_VERSION';
const newV = '$NEW_VERSION';
const failures = [];
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
if (pkg.version !== newV) failures.push('package.json version=' + pkg.version);
const tauri = JSON.parse(fs.readFileSync('./src-tauri/tauri.conf.json', 'utf8'));
if (tauri.version !== newV) failures.push('tauri.conf.json version=' + tauri.version);
const toml = fs.readFileSync('./src-tauri/Cargo.toml', 'utf8');
const tomlMatch = toml.match(/^\s*version\s*=\s*\"([^\"]+)\"/m);
if (!tomlMatch || tomlMatch[1] !== newV) failures.push('Cargo.toml version=' + (tomlMatch ? tomlMatch[1] : '<none>'));
const lock = fs.readFileSync('./src-tauri/Cargo.lock', 'utf8');
const lockMatch = lock.match(/name\s*=\s*\"rexa-db\"\s*\nversion\s*=\s*\"([^\"]+)\"/);
if (!lockMatch || lockMatch[1] !== newV) failures.push('Cargo.lock rexa-db version=' + (lockMatch ? lockMatch[1] : '<none>'));
const flake = fs.readFileSync('./flake.nix', 'utf8');
const flakeMatch = flake.match(/^\s*version\s*=\s*\"([^\"]+)\";/m);
if (!flakeMatch || flakeMatch[1] !== newV) failures.push('flake.nix version=' + (flakeMatch ? flakeMatch[1] : '<none>'));
for (const v of [pkg.version, tauri.version, tomlMatch && tomlMatch[1], lockMatch && lockMatch[1], flakeMatch && flakeMatch[1]]) {
  if (v === oldV) failures.push('stale version ' + oldV + ' still present');
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('  versions verified: ' + newV);
"
if [[ $? -ne 0 ]]; then
  fail "Stale version $CURRENT_VERSION still present after bump."
  exit 1
fi
success "Version bumped to $NEW_VERSION in all 5 files"

# ── Step 6: commit + lightweight tag (matches existing vX.Y.Z tag style) ────
git add package.json src-tauri/Cargo.lock src-tauri/Cargo.toml src-tauri/tauri.conf.json flake.nix
git commit -m "chore: bump version to ${NEW_VERSION}"
git tag "v${NEW_VERSION}"
success "Committed ($(git rev-parse --short HEAD)) and tagged v${NEW_VERSION}"

# ── Step 7: optionally push ──────────────────────────────────────────────────
if [[ "$PUSH" == true ]]; then
  log "Pushing master + tag to origin..."
  git push origin master
  git push origin "v${NEW_VERSION}"
  success "Pushed master and v${NEW_VERSION}"
else
  log "Not pushing (pass --push to push commit + tag to origin)."
  log "To push later: git push origin master && git push origin v${NEW_VERSION}"
fi

success "${BOLD}Release bump to ${NEW_VERSION} complete.${NC}"
