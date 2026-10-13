{ pkgs, lib, src, version, rexadb_server, oracle_bridge, java_bridge }:

# RexaDB desktop binary (Tauri v2, Linux) via the official nixpkgs
# `cargo-tauri.hook` on top of `rustPlatform.buildRustPackage`
# (nixpkgs manual: "Tauri" hook section).
#
# How the pieces fit (mirrors `.github/workflows/build.yml`):
# - `cargoLock`: hermetic Rust vendoring (fixed-output, per-crate).
# - `npmDeps`: offline npm cache (v2, with packuments); `configurePhase`
#   installs it so the hook's `beforeBuildCommand` (`next build`) runs in
#   the sandbox and emits `./out` for `frontendDist` in place.
#   (The standalone `frontend` package builds the same export separately
#   for inspection; the desktop build does not consume it.)
# - `postPatch` stages the sidecar (`externalBin`) and `resources`
#   (`bridge.jar`, `jre/`, oracle bridge) that `tauri.conf.json` references
#   but that are gitignored (absent from `$src`).
# - `tauriBundleType = "deb"` (this cargo-tauri rejects `--bundles none`);
#   `installPhase` extracts the .deb and lays out a store-friendly tree
#   instead of installing FHS paths — binary, triple-suffixed sidecar,
#   resources, plus the real Tauri-generated .desktop entry + icons.
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
    hash = "sha256-Y8mAKK57pCBep2Cdr+riJ4oXKcD60BEZvVrkASICf1g=";
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
      dpkg # extract the .deb the tauri build emits (`tauriBundleType`)
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

  tauriBundleType = "deb";
  dontTauriInstall = true;

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
    # `true`, not `1`: the cargo-tauri hook forwards $CI as `--ci $CI`
    # and tauri only accepts true/false.
    export CI=true
    # Manual `npm ci` against a writable copy of the v2 cache
    # (see nix/frontend.nix) — deliberately not via npmConfigHook,
    # whose automatic postPatch install would duplicate this.
    cp -r ${npmDeps} $TMPDIR/npm-cache
    chmod -R u+w $TMPDIR/npm-cache
    export npm_config_cache=$TMPDIR/npm-cache
    npm ci --offline --no-audit --no-fund
    # Placeholder Supabase config for the tauri `beforeBuildCommand`
    # (`next build`, same rationale as in nix/frontend.nix).
    export NEXT_PUBLIC_SUPABASE_URL="https://nix-placeholder.supabase.co"
    export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="nix-placeholder-key"
    (cd node_modules/better-drizzle && patch -p1 --batch < ../../patches/better-drizzle@0.1.1.patch)
    (cd node_modules/@glideapps/glide-data-grid && patch -p1 --batch < ../../../patches/@glideapps%2Fglide-data-grid@6.0.4-alpha24.patch)
    # The sandbox has no /usr/bin/env, but package scripts use
    # #!/usr/bin/env node shebangs. Binaries under .bin are symlinks, so
    # patch the whole tree to reach the real interpreter lines (this also
    # covers the tauri `beforeBuildCommand` below).
    patchShebangs node_modules
    # `beforeBuildCommand` (`next build`) runs under plain sh during the
    # tauri build below — put the local bins on PATH for it.
    export PATH="$PWD/node_modules/.bin:$PATH"
    runHook postConfigure
  '';

  installPhase = ''
    runHook preInstall
    debs=(src-tauri/target/release/bundle/deb/*.deb)
    (( ''${#debs[@]} == 1 )) || { echo "FATAL: expected exactly one .deb, found: ''${debs[*]}" >&2; exit 1; }
    debroot=$TMPDIR/debroot
    mkdir -p $debroot
    dpkg -x "''${debs[0]}" $debroot

    mkdir -p $out/bin $out/share/rexadb $out/share/rexadb/oracle-bridge

    test -f $debroot/usr/bin/rexa-db || { echo "FATAL: main binary missing in .deb" >&2; exit 1; }
    cp $debroot/usr/bin/rexa-db $out/share/rexadb/

    # Sidecar (Tauri externalBin) ships exe-adjacent in the deb; keep the
    # triple-suffixed name (cf. CI smoke test) and mirror it beside the
    # wrapper, which is where Tauri resolves it at runtime.
    sidecar=$(find $debroot/usr/bin -maxdepth 1 -name 'rexadb-server-*' | head -1)
    test -n "$sidecar" || { echo "FATAL: sidecar missing in .deb" >&2; find $debroot/usr/bin | head; exit 1; }
    cp "$sidecar" $out/share/rexadb/
    cp "$sidecar" $out/bin/

    # Resources live under /usr/lib/<product> in the deb; locate by name
    # rather than hardcoding the product dir.
    jar=$(find $debroot/usr/lib -name bridge.jar | head -1)
    test -n "$jar" || { echo "FATAL: bridge.jar missing in .deb" >&2; exit 1; }
    cp "$jar" $out/share/rexadb/
    jre=$(dirname "$jar")/jre
    test -d "$jre" || { echo "FATAL: jre/ missing in .deb" >&2; exit 1; }
    cp -r "$jre" $out/share/rexadb/
    obridge=$(find $debroot/usr/lib -name rexadb-oracle-bridge | head -1)
    test -n "$obridge" || { echo "FATAL: oracle bridge missing in .deb" >&2; exit 1; }
    cp "$obridge" $out/share/rexadb/oracle-bridge/

    # Exe-adjacent aliases so both `resource_dir() == $out/bin` and
    # `$RESOURCEDIR == $out/share/rexadb` resolve.
    ln -s ../share/rexadb/bridge.jar $out/bin/bridge.jar
    ln -s ../share/rexadb/jre $out/bin/jre
    ln -s ../share/rexadb/oracle-bridge $out/bin/oracle-bridge

    # Real Tauri-generated launcher entry + icons from the deb.
    test -d $debroot/usr/share/applications && cp -r $debroot/usr/share/applications $out/share/
    test -d $debroot/usr/share/icons && cp -r $debroot/usr/share/icons $out/share/

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
