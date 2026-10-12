{ pkgs, src, version }:

# Compiled sidecar server (`bun build --compile server/index.ts`).
# Mirrors `scripts/build-server.mjs` (same `--target` matrix).
# Root `bun install` provides `../lib/**` imports; `server/bun.lock`
# provides express/cors/nearley. See `nix/frontend.nix` for the
# `__noChroot` rationale (network for the package registries; versions
# stay pinned by the lockfiles + `--frozen-lockfile`).
pkgs.stdenv.mkDerivation {
  pname = "rexadb-server";
  inherit version src;
  __noChroot = true;
  dontUnpack = true;

  nativeBuildInputs = [
    pkgs.bun
    # Native modules in the tree (better-sqlite3, duckdb) may run
    # node-gyp-style postinstall scripts.
    pkgs.python3
    pkgs.stdenv.cc
  ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    export CI=1
    bun install --frozen-lockfile --no-progress
    (cd server && bun install --frozen-lockfile --no-progress)
    bunTarget=${
      {
        "x86_64-linux" = "bun-linux-x64";
        "aarch64-linux" = "bun-linux-arm64";
        "x86_64-darwin" = "bun-darwin-x64";
        "aarch64-darwin" = "bun-darwin-arm64";
      }
      .${pkgs.stdenv.hostPlatform.system}
    }
    bun build --compile --target="$bunTarget" server/index.ts --outfile=rexadb-server
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    mkdir -p $out/bin
    cp rexadb-server $out/bin/
    runHook postInstall
  '';
}
