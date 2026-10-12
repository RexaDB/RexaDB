{ pkgs, lib, src, version }:

# Next.js static export (`out/`) for Tauri `frontendDist`, built hermetically:
# - JS deps come from `fetchNpmDeps` (fixed-output prefetch of
#   `package-lock.json`; `.npmrc` sets `legacy-peer-deps` to match bun's
#   lenient peer resolution for better-drizzle/drizzle-orm).
# - Fonts are vendored (`app/fonts`, `next/font/local`) so `next build`
#   never touches fonts.googleapis.com.
# - bun-format patches (`patchedDependencies`, unknown to npm) are applied
#   with `patch -p1` from inside each package dir: package-rooted hunks
#   apply; `.bun-tag` marker hunks land as harmless stray empty files.
#   A genuinely failing hunk fails the build loudly. `--batch` avoids
#   interactive prompts in the sandbox.
let
  npmDeps = pkgs.fetchNpmDeps {
    name = "rexadb-npm-deps-${version}";
    src = src;
    # TODO(#32): replace with the `got: sha256-…` value from CI and commit.
    hash = lib.fakeHash;
  };
in
pkgs.stdenv.mkDerivation {
  pname = "rexadb-frontend";
  inherit version src;
  dontUnpack = true;

  nativeBuildInputs = [
    pkgs.nodejs
    pkgs.python3 # node-gyp fallback for native postinstalls (better-sqlite3, duckdb)
    pkgs.patch
  ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    export CI=1
    export NEXT_TELEMETRY_DISABLED=1
    export npm_config_cache=${npmDeps}
    npm ci --offline --no-audit --no-fund
    (cd node_modules/better-drizzle && patch -p1 --batch < ../../patches/better-drizzle@0.1.1.patch)
    (cd node_modules/@glideapps/glide-data-grid && patch -p1 --batch < ../../../patches/@glideapps%2Fglide-data-grid@6.0.4-alpha24.patch)
    NODE_ENV=production npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    cp -r out $out
    runHook postInstall
  '';
}
