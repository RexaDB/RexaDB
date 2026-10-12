# Nix flake for RexaDB (resolves issue #30: "Nix flake based installs").
#
# Design (see `nix/` for the derivations; docs that pin the approach):
# - dev shell: NixOS wiki "Tauri" recipe + bun/node/rust/cargo-tauri/jdk21
#   (webkitgtk_4_1 etc. on Linux).
# - builds: plain `stdenv.mkDerivation`s driven by the repo's own lockfiles
#   (`bun.lock` + `--frozen-lockfile`, `Cargo.lock` + `--frozen`), in the
#   same order as `.github/workflows/build.yml`.
# - desktop bundle: `cargo tauri build --bundles none` with a `--config`
#   overlay that clears `beforeBuildCommand` (frontend prebuilt as
#   `packages.frontend`); store layout in `nix/rexadb.nix` satisfies both
#   Tauri `resource_dir()` and `$RESOURCEDIR` lookups.
#
# Quick start:
#   nix develop          # full toolchain (bun, node, rust, cargo-tauri, jdk21)
#   nix build .#frontend # Next.js static export (out/)
#   nix build .#rexadb-server
#   nix build .#rexadb   # desktop app (Linux)
#   nix run .            # launch the desktop app (Linux)
#
# First run generates `flake.lock` (network needed); please commit it.
{
  description = "RexaDB — modern database studio (Nix flake)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs@{ self, nixpkgs, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem = { system, ... }:
        let
          pkgs = import nixpkgs { inherit system; };
          lib = pkgs.lib;
          # Keep in sync with package.json + src-tauri/tauri.conf.json.
          version = "1.3.23";
          isLinux = pkgs.stdenv.isLinux;

          frontend = pkgs.callPackage ./nix/frontend.nix { inherit version; src = self; };
          rexadb_server = pkgs.callPackage ./nix/server.nix { inherit version; src = self; };
          oracle_bridge = pkgs.callPackage ./nix/oracle-bridge.nix { src = self; };
          java_bridge = pkgs.callPackage ./nix/java-bridge.nix { inherit version; src = self; };
          # Evaluates everywhere (cheap), builds on Linux (webkit/system libs).
          rexadb = pkgs.callPackage ./nix/rexadb.nix {
            inherit version frontend;
            inherit rexadb_server oracle_bridge java_bridge;
            src = self;
          };
        in
        {
          formatter = pkgs.nixpkgs-fmt;

          devShells.default = pkgs.callPackage ./nix/devshell.nix { };

          packages =
            {
              inherit frontend;
              rexadb-server = rexadb_server;
              rexadb-oracle-bridge = oracle_bridge;
              java-bridge = java_bridge;
              # Headless sidecar is the sensible default where the
              # desktop (Linux-only) isn't available.
              default = if isLinux then rexadb else rexadb_server;
            }
            // lib.optionalAttrs isLinux { inherit rexadb; };

          apps =
            {
              server = {
                type = "app";
                program = "${rexadb_server}/bin/rexadb-server";
              };
            }
            // lib.optionalAttrs isLinux {
              default = {
                type = "app";
                program = "${rexadb}/bin/rexa-db";
              };
              rexadb = {
                type = "app";
                program = "${rexadb}/bin/rexa-db";
              };
            };
        };

      flake = {
        nixosModules.default = import ./nix/nixos-module.nix;
        homeManagerModules.default = import ./nix/home-manager-module.nix;
      };
    };
}
