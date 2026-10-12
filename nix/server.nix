{ pkgs, lib, src, version, java_bridge, oracle_bridge }:

# Compiled sidecar server (`bun build --compile server/index.ts`).
# Mirrors `scripts/build-server.mjs` (same `--target` matrix).
#
# Hermetic dependency story (see `nix/frontend.nix` for the rationale):
# root `bun install` equivalent provides `../lib/**` imports while
# `server/package-lock.json` provides express/cors/nearley — two
# `fetchNpmDeps` caches wired by setting `npm_config_cache` per install
# (the documented cache contract; avoids multi-root hook tricks).
#
# The install output also bundles the JDBC/Oracle bridges behind
# `$RESOURCEDIR` (same contract as the desktop app, cf.
# `lib/db/jdbc-bridge-manager.ts`), so standalone `nix run .#server`
# and the NixOS service get working bridges instead of
# "bridge.jar not found".
let
  npmDepsRoot = pkgs.fetchNpmDeps {
    name = "rexadb-npm-deps-${version}";
    src = src;
    # TODO(#32): replace with the `got: sha256-…` value from CI and commit.
    hash = lib.fakeHash;
  };
  npmDepsServer = pkgs.fetchNpmDeps {
    name = "rexadb-server-npm-deps-${version}";
    src = "${src}/server";
    # TODO(#32): replace with the `got: sha256-…` value from CI and commit.
    hash = lib.fakeHash;
  };
  bunTarget =
    {
      "x86_64-linux" = "bun-linux-x64";
      "aarch64-linux" = "bun-linux-arm64";
      "x86_64-darwin" = "bun-darwin-x64";
      "aarch64-darwin" = "bun-darwin-arm64";
    }
    .${pkgs.stdenv.hostPlatform.system};
in
pkgs.stdenv.mkDerivation {
  pname = "rexadb-server";
  inherit version src;
  dontUnpack = true;

  nativeBuildInputs = [
    pkgs.bun # only the compiler; deps resolve from npm-installed node_modules
    pkgs.nodejs # provides `npm`
    pkgs.python3
    pkgs.stdenv.cc
    pkgs.patch
    pkgs.makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    export CI=1
    export npm_config_cache=${npmDepsRoot}
    npm ci --offline --no-audit --no-fund
    export npm_config_cache=${npmDepsServer}
    (cd server && npm ci --offline --no-audit --no-fund)
    (cd node_modules/better-drizzle && patch -p1 --batch < ../../patches/better-drizzle@0.1.1.patch)
    (cd node_modules/@glideapps/glide-data-grid && patch -p1 --batch < ../../../patches/@glideapps%2Fglide-data-grid@6.0.4-alpha24.patch)
    bun build --compile --target="${bunTarget}" server/index.ts --outfile=rexadb-server
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    mkdir -p $out/bin $out/share/rexadb $out/share/rexadb/oracle-bridge
    cp rexadb-server $out/bin/
    cp ${java_bridge}/share/rexadb/bridge.jar $out/share/rexadb/
    cp -r ${java_bridge}/share/rexadb/jre $out/share/rexadb/
    cp ${oracle_bridge}/bin/rexadb-oracle-bridge $out/share/rexadb/oracle-bridge/
    wrapProgram $out/bin/rexadb-server --set RESOURCEDIR $out/share/rexadb
    runHook postInstall
  '';
}
