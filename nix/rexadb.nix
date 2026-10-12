{ pkgs, lib, src, version, frontend, rexadb_server, oracle_bridge, java_bridge }:

# RexaDB desktop binary (Tauri v2, Linux).
#
# Build order mirrors `.github/workflows/build.yml`:
#   1. prebuilt frontend → `out/` (tauri.conf `frontendDist: ../out`)
#   2. compiled sidecar → `src-tauri/binaries/rexadb-server-<triple>`
#      (tauri.conf `externalBin`; resolved exe-adjacent at runtime,
#      same as the CI smoke test)
#   3. `bridge.jar` + `jre/` + oracle bridge → `resources/...`
#      (tauri.conf `resources`; consumed via `$RESOURCEDIR` by
#      `lib/db/jdbc-bridge-manager.ts` / `oracle-bridge-manager.ts`)
#   4. `cargo tauri build` with `--config` overlay clearing
#      `beforeBuildCommand` (the frontend is already built; running
#      `next build` again inside the sandbox would be impure).
#      `--bundles none` emits just the binary; `installPhase` lays out
#      a store-friendly tree instead of a .deb.
#
# Runtime layout rationale: both Tauri's `resource_dir()` (see
# `src-tauri/src/lib.rs:544`) and the `$RESOURCEDIR` fallback resolve
# against ONE resource base, so every resource lives under
# `$out/share/rexadb` with symlinks beside the exe (`$out/bin`) to cover
# the `resource_dir() == exe-dir` case. The wrapper sets
# `RESOURCEDIR=$out/share/rexadb`.
let
  triple =
    {
      "x86_64-linux" = "x86_64-unknown-linux-gnu";
      "aarch64-linux" = "aarch64-unknown-linux-gnu";
    }
    .${pkgs.stdenv.hostPlatform.system} or (throw "rexadb: only x86_64-linux / aarch64-linux are supported");
in
pkgs.stdenv.mkDerivation {
  pname = "rexadb";
  inherit version src;
  __noChroot = true; # see nix/frontend.nix (crates.io access; versions pinned by Cargo.lock + --locked)
  dontUnpack = true; # explicit work copy below (writes out/, binaries/, resources/)

  nativeBuildInputs = with pkgs; [
    rustc
    cargo
    cargo-tauri # nixpkgs ships Tauri CLI v2 (matches @tauri-apps/cli ^2)
    pkg-config
    wrapGAppsHook4 # wraps $out/bin for GSettings/pixbuf/GIO lookups on NixOS
    makeWrapper
  ];

  # Mirrors the apt list in `.github/workflows/build.yml` (+ dbus for dialogs/tray).
  buildInputs = with pkgs; [
    openssl
    webkitgtk_4_1
    gtk3
    libsoup_3
    librsvg
    libayatana-appindicator
    glib-networking
    dbus
    glib
  ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    export CARGO_HOME=$TMPDIR/cargo
    export CI=1
    # Needed by `-sys` crates that run bindgen at build time.
    export LIBCLANG_PATH=${pkgs.llvmPackages.libclang.lib}/lib

    # 1. Prebuilt frontend where tauri.conf.json expects it.
    cp -r ${frontend} ./out

    # 2. Sidecar for `externalBin: binaries/rexadb-server`.
    mkdir -p src-tauri/binaries
    cp ${rexadb_server}/bin/rexadb-server \
      src-tauri/binaries/rexadb-server-${triple}

    # 3. Bundled resources (these dirs are gitignored, so absent from $src).
    mkdir -p resources/java-bridge/dist resources/oracle-bridge
    cp ${java_bridge}/share/rexadb/bridge.jar resources/java-bridge/dist/
    cp -r ${java_bridge}/share/rexadb/jre resources/java-bridge/dist/
    cp ${oracle_bridge}/bin/rexadb-oracle-bridge resources/oracle-bridge/

    # 4. Desktop build. If `--bundles none` is ever rejected by a future
    #    cargo-tauri, fall back to `--bundles deb` + `pkgs.dpkg` in
    #    nativeBuildInputs.
    printf '{"build":{"beforeBuildCommand":""}}' > $TMPDIR/tauri-overlay.json
    cargo tauri build --bundles none --config $TMPDIR/tauri-overlay.json
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    mkdir -p $out/bin $out/share/rexadb $out/share/rexadb/oracle-bridge

    cp src-tauri/target/release/rexa-db $out/share/rexadb/
    cp ${rexadb_server}/bin/rexadb-server \
      $out/share/rexadb/rexadb-server-${triple}
    cp ${java_bridge}/share/rexadb/bridge.jar $out/share/rexadb/
    cp -r ${java_bridge}/share/rexadb/jre $out/share/rexadb/
    cp ${oracle_bridge}/bin/rexadb-oracle-bridge \
      $out/share/rexadb/oracle-bridge/

    # Sidecar MUST be exe-adjacent (Tauri externalBin lookup, cf. CI smoke test).
    cp $out/share/rexadb/rexadb-server-${triple} $out/bin/

    # Exe-adjacent aliases so both `resource_dir() == $out/bin` and
    # `$RESOURCEDIR == $out/share/rexadb` resolve (see header comment).
    ln -s ../share/rexadb/bridge.jar $out/bin/bridge.jar
    ln -s ../share/rexadb/jre $out/bin/jre
    ln -s ../share/rexadb/oracle-bridge $out/bin/oracle-bridge

    makeWrapper $out/share/rexadb/rexa-db $out/bin/rexa-db \
      --set RESOURCEDIR $out/share/rexadb
    runHook postInstall
  '';

  meta = {
    description = "RexaDB — modern desktop database studio";
    homepage = "https://www.rexadb.app";
    license = lib.licenses.gpl3Plus;
    platforms = lib.platforms.linux;
    mainProgram = "rexa-db";
  };
}
