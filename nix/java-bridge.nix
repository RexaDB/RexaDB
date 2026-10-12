{ pkgs, src, version }:

# JDBC bridge (`bridge.jar` + minimal JRE) via `resources/java-bridge/build.sh`
# (native path, same jlink module set). The script only looks for jmods at
# `$JAVA_HOME/jmods` / `$JAVA_HOME/../jmods`, whose layout varies per JDK
# distribution (see the Arch-CI symlink workaround in
# `.github/workflows/arch-appimage.yml`), so we stage a writable JAVA_HOME
# shim with `bin/` + `jmods/` linked in and fail loudly if the outputs that
# `lib/db/jdbc-bridge-manager.ts` requires are missing.
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
    jmodsDir=$(find "${pkgs.jdk21}" -maxdepth 5 -type d -name jmods -print -quit)
    if [ -z "$jmodsDir" ]; then
      echo "FATAL: jmods not found under ${pkgs.jdk21}" >&2
      exit 1
    fi
    jdkBin=""
    for d in "${pkgs.jdk21}/lib/openjdk/bin" "${pkgs.jdk21}/bin"; do
      if [ -x "$d/javac" ]; then jdkBin="$d"; break; fi
    done
    if [ -z "$jdkBin" ]; then
      echo "FATAL: javac not found under ${pkgs.jdk21}" >&2
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
