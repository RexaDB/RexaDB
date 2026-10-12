{ pkgs, lib, src, version, frontend, rexadb_server, oracle_bridge, java_bridge }:

# RexaDB desktop binary (Tauri v2, Linux) via the official nixpkgs
# `cargo-tauri.hook` on top of `rustPlatform.buildRustPackage`
# (nixpkgs manual: "Tauri" hook section).
#
# How the pieces fit (mirrors `.github/workflows/build.yml`):
# - `cargoLock` + `cargoHash`: hermetic Rust vendoring (fixed-output).
# - `npmDeps`: offline npm cache (v2, with packuments) so the hook's
#   `beforeBuildCommand` (`next build`) runs in the sandbox; `configurePhase`
#   installs it. Fonts are vendored (`app/fonts`), so no network needed.
# - `postPatch` stages the sidecar (`externalBin`) and `resources`
#   (`bridge.jar`, `jre/`, oracle bridge) that `tauri.conf.json` references
#   but that are gitignored (absent from `$src`).
# - `tauriBundleType = "none"` emits just the binary; `dontTauriInstall`
#   disables the hook installer in favour of the store layout below, which
#   satisfies both Tauri `resource_dir()` and `$RESOURCEDIR` lookups
#   (see `src-tauri/src/lib.rs:544` + both bridge managers). The sidecar
#   stays exe-adjacent like the CI smoke test.
let
  triple =
    {
      "x86_64-linux" = "x86_64-unknown-linux-gnu";
      "aarch64-linux" = "aarch64-unknown-linux-gnu";
    }
    .${pkgs.stdenv.hostPlatform.system} or (throw "rexadb: only x86_64-linux / aarch64-linux are supported");

  npmDeps = pkgs.fetchNpmDeps {
    name = "rexadb-npm-deps-${version}";
    src = src;
    # v2 also caches packuments (see nix/frontend.nix).
    fetcherVersion = 2;
    hash = "sha256-Z9BwKo88UNvqpOh7xkUW/E8cBQnF36RQF/9OX3n54j0=";
  };
in
pkgs.rustPlatform.buildRustPackage {
  pname = "rexadb";
  inherit version;
  src = src;
  cargoRoot = "src-tauri";
  buildAndTestSubdir = "src-tauri";
  cargoLock.lockFile = ../src-tauri/Cargo.lock;
  # NOTE: no `cargoHash` — current nixpkgs `buildRustPackage` fetches each
  # crate as a fixed-output derivation hashed from Cargo.lock (the
  # oracle-bridge package already proved this on CI).
  doCheck = false;

  inherit npmDeps;

  nativeBuildInputs =
    with pkgs;
    [
      cargo-tauri.hook
      nodejs # provides npm/node for the manual `npm ci` below + `next build`
      pkg-config
      python3 # node-gyp fallback for native postinstalls during `npm ci`
      patch # bun-format patches (`patchedDependencies`, unknown to npm)
      makeWrapper
      copyDesktopItems
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
      wrapGAppsHook4 # wraps $out/bin for GSettings/pixbuf/GIO lookups on NixOS
    ];

  # Mirrors the apt list in `.github/workflows/build.yml` (+ dbus, glib).
  buildInputs = with pkgs; [
    openssl
  ] ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
    webkitgtk_4_1
    gtk3
    libsoup_3
    librsvg
    libayatana-appindicator
    glib-networking
    dbus
    glib
  ];

  tauriBundleType = "none";
  dontTauriInstall = true;

  desktopItems = [
    (pkgs.makeDesktopItem {
      name = "rexa-db";
      exec = "rexa-db";
      icon = "rexa-db";
      desktopName = "RexaDB";
      genericName = "Database Studio";
      comment = "Modern desktop database studio";
      categories = [ "Development" "Database" ];
    })
  ];

  postPatch = ''
    # Sidecar for `externalBin: binaries/rexadb-server`.
    mkdir -p src-tauri/binaries
    cp ${rexadb_server}/bin/rexadb-server \
      src-tauri/binaries/rexadb-server-${triple}

    # Bundled resources (gitignored, so absent from $src).
    mkdir -p resources/java-bridge/dist resources/oracle-bridge
    cp ${java_bridge}/share/rexadb/bridge.jar resources/java-bridge/dist/
    cp -r ${java_bridge}/share/rexadb/jre resources/java-bridge/dist/
    cp ${oracle_bridge}/bin/rexadb-oracle-bridge resources/oracle-bridge/
  '';

  configurePhase = ''
    runHook preConfigure
    export HOME=$TMPDIR
    export CI=1
    # Manual `npm ci` against a writable copy of the v2 cache
    # (see nix/frontend.nix) — deliberately not via npmConfigHook,
    # whose automatic postPatch install would duplicate this.
    cp -r ${npmDeps} $TMPDIR/npm-cache
    chmod -R u+w $TMPDIR/npm-cache
    export npm_config_cache=$TMPDIR/npm-cache
    npm ci --offline --no-audit --no-fund
    (cd node_modules/better-drizzle && patch -p1 --batch < ../../patches/better-drizzle@0.1.1.patch)
    (cd node_modules/@glideapps/glide-data-grid && patch -p1 --batch < ../../../patches/@glideapps%2Fglide-data-grid@6.0.4-alpha24.patch)
    # `beforeBuildCommand` (`next build`) runs under plain sh during the
    # tauri build below — put the local bins on PATH for it.
    export PATH="$PWD/node_modules/.bin:$PATH"
    runHook postConfigure
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin $out/share/rexadb $out/share/rexadb/oracle-bridge \
      $out/share/icons/hicolor/128x128/apps

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
    # `$RESOURCEDIR == $out/share/rexadb` resolve.
    ln -s ../share/rexadb/bridge.jar $out/bin/bridge.jar
    ln -s ../share/rexadb/jre $out/bin/jre
    ln -s ../share/rexadb/oracle-bridge $out/bin/oracle-bridge

    # Launcher icon (from the Tauri bundle icons).
    cp src-tauri/icons/128x128.png \
      $out/share/icons/hicolor/128x128/apps/rexa-db.png

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
