{ pkgs, lib, src }:

# Native Oracle thin-driver bridge (`src-tauri/oracle-bridge`).
# Mirrors `scripts/build-oracle-bridge.mjs` (`cargo build --release`).
pkgs.rustPlatform.buildRustPackage {
  pname = "rexadb-oracle-bridge";
  version = "0.1.0"; # keep in sync with src-tauri/oracle-bridge/Cargo.toml
  src = "${src}/src-tauri/oracle-bridge";
  cargoLock.lockFile = ../src-tauri/oracle-bridge/Cargo.lock;
  # NOTE: no `cargoHash` — current nixpkgs `buildRustPackage` fetches each
  # crate as a fixed-output derivation hashed from Cargo.lock (proven by CI:
  # this package built green with the lockfile alone).
  doCheck = false;

  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.cmake # aws-lc-sys native build
    pkgs.perl # aws-lc-sys build scripts
  ];

  buildInputs = [ pkgs.openssl ];

  meta = {
    description = "RexaDB native Oracle thin-driver bridge";
    license = lib.licenses.gpl3Plus;
    mainProgram = "rexadb-oracle-bridge";
  };
}
