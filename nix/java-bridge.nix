{ pkgs, src, version }:

# JDBC bridge (`bridge.jar` + minimal JRE) via `resources/java-bridge/build.sh`
# (native path, same jlink module set). The script only looks for jmods at
# `$JAVA_HOME/jmods` / `$JAVA_HOME/../jmods`, whose layout varies per JDK
# distribution (Temurin `lib/openjdk`, Zulu macOS `Contents/Home` bundles,
# plain prefixes — often behind symlinks), so we resolve jmods from the real
# `javac` location first, fall back to a symlink-following sweep, stage a
# writable JAVA_HOME shim with `bin/` + `jmods/` linked in, and fail loudly
# if the outputs that `lib/db/jdbc-bridge-manager.ts` requires are missing.
pkgs.stdenv.mkDerivation {
  pname = "rexadb-java-bridge";
  inherit version;
  src = "${src}/resources/java-bridge";
  dontUnpack = true;

  nativeBuildInputs = [ pkgs.jdk21 ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    # javac comes from nativeBuildInputs (pkgs.jdk21). Resolve through
    # symlinks first: wrappers/shims mean `command -v` alone may not sit
    # next to the real tree (notably Zulu macOS bundles).
    javacBin="$(command -v javac)"
    if [ -z "$javacBin" ]; then
      echo "FATAL: javac not on PATH (pkgs.jdk21 missing from nativeBuildInputs?)" >&2
      exit 1
    fi
    jdkBin="$(dirname "$(readlink -f "$javacBin")")"
    # jmods usually sits next to bin/ (Temurin lib/openjdk, Zulu
    # Contents/Home, plain prefixes); walk up for odd nests, then fall back
    # to a symlink-following sweep of the whole JDK package.
    jmodsDir=""
    probe="$jdkBin"
    for _ in 1 2 3; do
      if [ -d "$probe/../jmods" ]; then jmodsDir="$probe/../jmods"; break; fi
      probe="$(dirname "$probe")"
    done
    if [ -z "$jmodsDir" ]; then
      jmodsDir=$(find -L "${pkgs.jdk21}" -maxdepth 8 -type d -name jmods -print -quit)
    fi
    if [ -z "$jmodsDir" ]; then
      echo "FATAL: jmods not found (javac at $javacBin -> $jdkBin/javac)" >&2
      echo "Top-level JDK layout:" >&2
      ls "${pkgs.jdk21}" >&2 || true
      exit 1
    fi
    mkdir -p $TMPDIR/javahome
    ln -sfn "$jdkBin" $TMPDIR/javahome/bin
    ln -sfn "$jmodsDir" $TMPDIR/javahome/jmods
    export JAVA_HOME=$TMPDIR/javahome
    export PATH=$JAVA_HOME/bin:$PATH
    bash build.sh
    test -f dist/bridge.jar || { echo "FATAL: dist/bridge.jar not produced" >&2; exit 1; }
    test -f dist/jre/lib/modules || { echo "FATAL: dist/jre incomplete (lib/modules missing)" >&2; exit 1; }
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    mkdir -p $out/share/rexadb
    cp dist/bridge.jar $out/share/rexadb/
    cp -r dist/jre $out/share/rexadb/
    runHook postInstall
  '';
}
