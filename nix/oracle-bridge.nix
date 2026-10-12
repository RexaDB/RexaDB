{ pkgs, src }:

# Native Oracle thin-driver bridge (`src-tauri/oracle-bridge`).
# Mirrors `scripts/build-oracle-bridge.mjs` (`cargo build --release`).
# `--locked` enforces `Cargo.lock` (fails if the lock needs changes) while
# still fetching the pinned crates; see `nix/frontend.nix` for the
# `__noChroot` rationale (crates.io access).
pkgs.stdenv.mkDerivation {
  pname = "rexadb-oracle-bridge";
  version = "0.1.0"; # keep in sync with src-tauri/oracle-bridge/Cargo.toml
  src = "${src}/src-tauri/oracle-bridge";
  __noChroot = true;
  dontUnpack = true;

  nativeBuildInputs = [
    pkgs.cargo
    pkgs.rustc
    pkgs.pkg-config
  ];

  buildInputs = [ pkgs.openssl ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    export CARGO_HOME=$TMPDIR/cargo
    export CI=1
    cargo build --locked --release
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    mkdir -p $out/bin
    cp target/release/rexadb-oracle-bridge $out/bin/
    runHook postInstall
  '';
}
