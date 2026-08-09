#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build-appimage.sh — Build RexaDB Linux AppImage with all fixes
#
# Fixes applied:
#   1. Builds --bundles deb (skips AppImage in tauri build — the cached
#      linuxdeploy crashes on modern Arch's .relr.dyn sections)
#   2. Creates AppDir manually, runs linuxdeploy+gtk plugin separately
#   3. Wraps AppRun with WEBKIT_DISABLE_DMABUF_RENDERER=1 (fixes
#      "Error 71 (Protocol error) dispatching to Wayland display")
#   4. Relative symlinks at AppDir root (avoids broken squashfs paths)
#   5. Removes linuxdeploy's AppRun symlink before writing wrapper,
#      re-copies the real binary (fixes doubled-path overwrite bug)
#
# Usage:
#   ./scripts/build-appimage.sh                       # auto-detects existing builds
#   ./scripts/build-appimage.sh --force-bridge        # rebuild Java bridge
#   ./scripts/build-appimage.sh --install-tools       # download deps first
#
# Env:
#   LINUXDEPLOY    Path to linuxdeploy (default: ~/.cache/tauri/linuxdeploy-x86_64.AppImage)
#   APPIMAGETOOL   Path to appimagetool (default: ~/.local/bin/appimagetool-x86_64.AppImage)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}[appimage]${NC} $*"; }
success() { echo -e "${GREEN}[  ✓  ]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn ]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL ]${NC} $*"; }

LINUXDEPLOY="${LINUXDEPLOY:-$HOME/.cache/tauri/linuxdeploy-x86_64.AppImage}"
APPIMAGETOOL="${APPIMAGETOOL:-$HOME/.local/bin/appimagetool-x86_64.AppImage}"
FORCE_BRIDGE=false
SKIP_TAURI_BUILD=false
SKIP_BRIDGE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-bridge)      FORCE_BRIDGE=true; shift ;;
    --install-tools)     INSTALL_TOOLS=true; shift ;;
    --skip-tauri-build)  SKIP_TAURI_BUILD=true; shift ;;
    --skip-bridge)       SKIP_BRIDGE=true; shift ;;
    *)                   echo "Unknown: $1"; exit 1 ;;
  esac
done

if [[ "$(uname)" != "Linux" ]]; then
  fail "Linux only."
  exit 1
fi

# ── Install tools ──────────────────────────────────────────────────────────
if [[ "${INSTALL_TOOLS:-false}" == "true" ]]; then
  log "Downloading appimagetool..."
  mkdir -p "$HOME/.local/bin"
  curl -fsSL -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL"
  success "appimagetool → $APPIMAGETOOL"
fi

# ── Preflight ──────────────────────────────────────────────────────────────
command -v bun &>/dev/null  || { fail "bun required";  exit 1; }
command -v cargo &>/dev/null || { fail "cargo required"; exit 1; }
command -v node &>/dev/null  || { fail "node required";  exit 1; }

[[ -f "$LINUXDEPLOY" ]]  || fail "linuxdeploy not found at $LINUXDEPLOY"
[[ -f "$APPIMAGETOOL" ]] || fail "appimagetool not found at $APPIMAGETOOL"

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
OUTPUT="${PROJECT_ROOT}/RexaDB_${VERSION}_x86_64.AppImage"

log "RexaDB v${VERSION} AppImage build"
log ""

# ── Step 0: Build Java bridge (bridge.jar + JRE) ───────────────────────────
BRIDGE_JAR="resources/java-bridge/dist/bridge.jar"
JRE_DIR="resources/java-bridge/dist/jre"
JRE_JAVA="$JRE_DIR/bin/java"

build_java_bridge() {
  log "Building Java bridge (bridge.jar + JRE)..."
  if command -v docker &>/dev/null; then
    bash resources/java-bridge/build.sh --docker
  elif command -v javac &>/dev/null && [[ -d "${JAVA_HOME:-}/jmods" ]]; then
    bash resources/java-bridge/build.sh
  else
    fail "Need docker or a JDK with jmods to build the Java bridge."
    fail "  - Install docker: pacman -S docker"
    fail "  - Or install JDK:  pacman -S jdk21-openjdk"
    return 1
  fi
}

if [[ "$SKIP_BRIDGE" == true ]]; then
  log "Skipping Java bridge build (--skip-bridge)"
elif [[ "$FORCE_BRIDGE" == true ]]; then
  build_java_bridge
elif [[ -f "$BRIDGE_JAR" && -f "$JRE_JAVA" ]]; then
  log "Java bridge already built (bridge.jar + JRE found)"
else
  log "Java bridge artifacts missing, building..."
  build_java_bridge
fi

if [[ "$SKIP_BRIDGE" != true ]]; then
  if [[ ! -f "$BRIDGE_JAR" ]]; then
    fail "bridge.jar not found at $BRIDGE_JAR"
    exit 1
  fi
  if [[ ! -f "$JRE_JAVA" ]]; then
    fail "JRE java not found at $JRE_JAVA"
    exit 1
  fi
  success "Java bridge ready"
fi

# ── Step 1: Tauri build ────────────────────────────────────────────────────
TAURI_BIN="src-tauri/target/release/rexa-db"
if [[ "$SKIP_TAURI_BUILD" == true ]]; then
  log "Skipping Tauri build (--skip-tauri-build)"
  if [[ ! -f "$TAURI_BIN" ]]; then
    fail "Binary not found at $TAURI_BIN (--skip-tauri-build requires a pre-built binary)"
    exit 1
  fi
  success "Tauri binary found at $TAURI_BIN"
elif [[ -f "$TAURI_BIN" ]]; then
  log "Tauri binary already built (found $TAURI_BIN)"
else
  log "Building Tauri app (skipping AppImage — handled manually)..."
  export PATH="./node_modules/.bin:$PATH"
  bun run server:build
  # tauri build may return non-zero due to RPM signing key check;
  # deb and binary are built either way, so we ignore its exit code
  tauri build --bundles deb || true
  success "Tauri build complete"
fi

# ── Step 2: Create AppDir from binary ──────────────────────────────────────
APPDIR="${PROJECT_ROOT}/src-tauri/target/rexa-db.AppDir"
log "Creating AppDir: $APPDIR"
rm -rf "$APPDIR"

mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$APPDIR/usr/lib"

cp "src-tauri/target/release/rexa-db" "$APPDIR/usr/bin/rexa-db"

# Generate .desktop file (Tauri generates this at build time, not in source)
cat > "$APPDIR/usr/share/applications/RexaDB.desktop" << 'DESKTOP'
[Desktop Entry]
Categories=
Comment=Rexa DB - The Modern Database Desktop App
Exec=rexa-db
StartupWMClass=rexa-db
Icon=rexa-db
Name=RexaDB
Terminal=false
Type=Application
DESKTOP

# Pick best available icon
ICON_SRC="src-tauri/icons/icon.png"
if [[ ! -f "$ICON_SRC" ]]; then
  ICON_SRC="src-tauri/icons/128x128.png"
fi
cp "$ICON_SRC" "$APPDIR/usr/share/icons/hicolor/256x256/apps/rexa-db.png"
cp "$ICON_SRC" "$APPDIR/rexa-db.png"

# Create top-level symlinks for AppImage conventions
ln -s usr/share/applications/RexaDB.desktop "$APPDIR/RexaDB.desktop"
ln -s rexa-db.png "$APPDIR/.DirIcon"
success "AppDir created at $APPDIR"

# ── Step 3: Deploy libraries via linuxdeploy with GTK plugin ───────────────
log "Deploying libraries via linuxdeploy..."

# Arch Linux's modern ELF libraries use .relr.dyn sections that linuxdeploy's
# bundled strip (old binutils) cannot handle. Fix: extract linuxdeploy, replace
# its bundled strip with a no-op, then run the extracted version.
LINUXDEPLOY_EXTRACT="$HOME/.cache/tauri/linuxdeploy-no-strip"
rm -rf "$LINUXDEPLOY_EXTRACT"
mkdir -p "$LINUXDEPLOY_EXTRACT"
log "Extracting linuxdeploy and patching strip..."
cd "$LINUXDEPLOY_EXTRACT"
APPIMAGE_EXTRACT_AND_RUN=1 "$LINUXDEPLOY" --appimage-extract >/dev/null 2>&1
cd "$PROJECT_ROOT"

# Replace bundled strip with a no-op
cat > "$LINUXDEPLOY_EXTRACT/squashfs-root/usr/bin/strip" << 'NOOP'
#!/bin/bash
exit 0
NOOP
chmod +x "$LINUXDEPLOY_EXTRACT/squashfs-root/usr/bin/strip"
success "Patched linuxdeploy strip → no-op"

# Run extracted linuxdeploy (avoids strip errors on Arch)
"$LINUXDEPLOY_EXTRACT/squashfs-root/AppRun" \
  --appdir "$APPDIR" \
  --executable "$APPDIR/usr/bin/rexa-db" || {
    fail "linuxdeploy failed (exit $?)"
    fail "AppDir contents:"
    ls -la "$APPDIR/usr/lib/" 2>/dev/null || true
    exit 1
  }
# linuxdeploy --executable creates AppRun -> usr/bin/rexa-db as a symlink.
# Remove it so writing the wrapper below doesn't follow the symlink and
# overwrite the real binary with the shell script.
rm -f "$APPDIR/AppRun"
cp "src-tauri/target/release/rexa-db" "$APPDIR/usr/bin/rexa-db"
success "Libraries deployed"

# ── Step 4: Bundle sidecar binary (Tauri's externalBin) ───────────────────
# Tauri's shell().sidecar("rexadb-server") resolves the binary at runtime
# as exe_dir / "rexadb-server" (relative_command_path in tauri-plugin-shell).
# The triple suffix is stripped during the build copy; at runtime only the
# clean name matters, placed alongside the main binary.
log "Bundling sidecar binary..."
cp src-tauri/binaries/rexadb-server-x86_64-unknown-linux-gnu \
   "$APPDIR/usr/bin/rexadb-server"
chmod +x "$APPDIR/usr/bin/rexadb-server"
success "Sidecar bundled"

# ── Step 4.5: Bundle JDBC bridge resources (bridge.jar + JRE) ─────────────
# Tauri resources config maps these to the app resource directory.
# On Linux deb: /usr/lib/<product-name>/<resource>
# With binary at $APPDIR/usr/bin/rexa-db, resources go to $APPDIR/usr/lib/RexaDB/
log "Bundling JDBC bridge resources..."
mkdir -p "$APPDIR/usr/lib/RexaDB"
cp -a resources/java-bridge/dist/bridge.jar "$APPDIR/usr/lib/RexaDB/bridge.jar"
cp -a resources/java-bridge/dist/jre    "$APPDIR/usr/lib/RexaDB/jre"
chmod -R u+rwX "$APPDIR/usr/lib/RexaDB"
success "JDBC bridge resources bundled ($(du -sh "$APPDIR/usr/lib/RexaDB" | cut -f1))"

# ── Step 5: Create AppRun (linuxdeploy doesn't create one without
#           --output appimage) with WebKit Wayland workaround ───────────────
log "Creating AppRun with WEBKIT_DISABLE_DMABUF_RENDERER=1..."
cat > "$APPDIR/AppRun" << 'WRAPPER'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export RESOURCEDIR="$HERE/usr/lib/RexaDB"
exec "$HERE/usr/bin/rexa-db" "$@"
WRAPPER
chmod +x "$APPDIR/AppRun"
success "AppRun created"

# ── Step 6: Package AppImage ───────────────────────────────────────────────
log "Packaging AppImage..."
rm -f "$OUTPUT"
APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "$APPDIR" "$OUTPUT"
success "AppImage: $OUTPUT"

# ── Step 7: Verify ─────────────────────────────────────────────────────────
SHA256=$(openssl dgst -sha256 "$OUTPUT" | awk '{print $2}')
SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
log "SHA256: $SHA256"
log "Size:   $SIZE"
echo ""

success "${BOLD}Done!${NC}"
