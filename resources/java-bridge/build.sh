#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build.sh — Build bridge.jar and minimal JRE for the JDBC bridge
#
# Usage:
#   ./build.sh                          # native build (macOS with JDK)
#   ./build.sh --docker                 # Docker-based build (Linux)
#   ./build.sh --docker-tag <tag>       # custom Docker image (default: eclipse-temurin:21-jdk)
#   ./build.sh --skip-jlink             # build jar only, skip JRE
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

BUILD_DIR="out"
DIST_DIR="dist"
BRIDGE_JAR="$DIST_DIR/bridge.jar"
JRE_DIR="$DIST_DIR/jre"
DOCKER=false
DOCKER_TAG="eclipse-temurin:21-jdk"
SKIP_JLINK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)     DOCKER=true; shift ;;
    --docker-tag) DOCKER_TAG="$2"; shift 2 ;;
    --skip-jlink) SKIP_JLINK=true; shift ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

if [[ "$DOCKER" == true ]]; then
  echo "=== Docker-based build (image: $DOCKER_TAG) ==="
  rm -rf "$JRE_DIR" "$BUILD_DIR"/* 2>/dev/null || true
  mkdir -p "$DIST_DIR"
  docker run --rm \
    -v "$(pwd):/src" \
    -v "$(pwd)/$DIST_DIR:/dist" \
    "$DOCKER_TAG" sh -c "
      echo '=== Compiling Bridge.java ==='
      javac --release 21 -d /src/out /src/src/Bridge.java
      echo '=== Packaging bridge.jar ==='
      jar cfe /dist/bridge.jar Bridge -C /src/out .
      chmod 644 /dist/bridge.jar
      echo 'Bridge JAR: \$(ls -lh /dist/bridge.jar)'
      if [ \"$SKIP_JLINK\" != true ]; then
        echo '=== Building minimal JRE with jlink ==='
        jlink --module-path /opt/java/openjdk/jmods \
          --add-modules java.base,java.sql,jdk.crypto.ec,java.management,java.naming,java.security.jgss \
          --output /tmp/jreout \
          --strip-debug \
          --compress=0 \
          --no-header-files \
          --no-man-pages
        mkdir -p /dist/jre
        cp -a /tmp/jreout/* /dist/jre/
        chmod -R 755 /dist/jre
        chmod -R u+w /dist/jre
        find /dist/jre/legal -type l -delete 2>/dev/null || true
        echo 'JRE size: \$(du -sh /dist/jre | cut -f1)'
      fi
      echo 'Done!'
    "
  docker run --rm -v "$(pwd)/$DIST_DIR:/dist" alpine sh -c "chown -R 1000:1000 /dist" 2>/dev/null || true
  exit 0
fi

# ── Native build (macOS) ──────────────────────────────────────────────────
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home)}"
echo "Using JDK: $JAVA_HOME"

mkdir -p "$BUILD_DIR" "$DIST_DIR"

echo "=== Compiling Bridge.java ==="
javac --release 21 -d "$BUILD_DIR" src/Bridge.java

echo "=== Packaging bridge.jar ==="
jar cfe "$BRIDGE_JAR" Bridge -C "$BUILD_DIR" .
echo "Bridge JAR: $(ls -lh "$BRIDGE_JAR")"

if [[ "$SKIP_JLINK" == true ]]; then
  echo "Skipping jlink (--skip-jlink)"
  echo "Done!"
  exit 0
fi

echo "=== Building minimal JRE with jlink ==="
JMODS="$JAVA_HOME/jmods"
if [ ! -d "$JMODS" ]; then
  echo "jmods not found at $JMODS, trying alternate locations..."
  if [ -d "$JAVA_HOME/../jmods" ]; then
    JMODS="$JAVA_HOME/../jmods"
  else
    echo "WARNING: jmods directory not found. Skipping jlink."
    echo "To build JRE manually: jlink --module-path \$JAVA_HOME/jmods --add-modules java.base,java.sql,jdk.crypto.ec --output jre"
    exit 0
  fi
fi

rm -rf "$JRE_DIR"
jlink --module-path "$JMODS" \
  --add-modules java.base,java.sql,jdk.crypto.ec,java.management,java.naming,java.security.jgss \
  --output "$JRE_DIR" \
  --strip-debug \
  --compress=0 \
  --no-header-files \
  --no-man-pages

chmod -R u+w "$JRE_DIR"
find "$JRE_DIR/legal" -type l -delete 2>/dev/null || true

echo "JRE size: $(du -sh "$JRE_DIR" | cut -f1)"
echo "Done!"