{ pkgs, lib, src, version }:

# Next.js static export (`out/`) for Tauri `frontendDist`, built hermetically:
# - JS deps come from `fetchNpmDeps` (fixed-output prefetch of
#   `package-lock.json`; `package.json` `overrides` pin bun-tolerated
#   peer resolutions — better-drizzle/drizzle-orm, @types/react-dom
#   — so strict npm resolution matches the working bun tree).
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
    # v2 caches registry packuments as well as tarballs: `npm ci`
    # re-resolves peer/override edges and needs packuments even with a
    # complete lockfile (else ENOTCACHED under --offline).
    fetcherVersion = 2;
    hash = "sha256-HZu3aGzQ4Y8+VoxE5InCF1SyCT/mj+azcb4boZgfnz0=";
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
    # Writable copy: with fetcherVersion 2 a cache key can hold multiple
    # entries and npm must write to the cache (same reason npmConfigHook
    # copies it aside).
    cp -r ${npmDeps} $TMPDIR/npm-cache
    chmod -R u+w $TMPDIR/npm-cache
    export npm_config_cache=$TMPDIR/npm-cache
    # --legacy-peer-deps: the trimmed packuments from prefetch-npm-deps
    # prefetch-npm-deps (fetcher v2) only contain lockfile versions, so a
    # strict peer re-resolution (driven by `overrides`) can demand
    # neighbouring versions that don't exist in the cache and then
    # ping-pong on ERESOLVE forever offline. With a complete lockfile the
    # resulting tree is identical; this only skips peer re-resolution.
    npm ci --offline --no-audit --no-fund --legacy-peer-deps
    # glide-data-grid imports lodash/marked/react-responsive-carousel but
    # declares them as peerDependencies (bun auto-installs peers, npm
    # --legacy-peer-deps does not), so top them up from the same offline
    # cache. Same flag as above: these are cache-backed lockfile
    # versions; strict re-resolution would hit the trimmed-packument
    # ERESOLVE ping-pong again.
    npm install --offline --no-save --no-audit --no-fund --legacy-peer-deps \
      lodash marked react-is react-responsive-carousel
    # Placeholder Supabase config: the static export inlines
    # NEXT_PUBLIC_* at build time and lib/supabase/client.ts throws
    # without them. Real secrets must never enter the store; local-first
    # features work fully, Supabase-backed features (sign-in, teams)
    # fail gracefully at use time. Substitute your own values here for
    # a cloud-connected build (see README).
    export NEXT_PUBLIC_SUPABASE_URL="https://nix-placeholder.supabase.co"
    export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="nix-placeholder-key"
    (cd node_modules/better-drizzle && patch -p1 --batch < ../../patches/better-drizzle@0.1.1.patch)
    (cd node_modules/@glideapps/glide-data-grid && patch -p1 --batch < ../../../patches/@glideapps%2Fglide-data-grid@6.0.4-alpha24.patch)
    # The sandbox has no /usr/bin/env, but package scripts use
    # #!/usr/bin/env node shebangs. Binaries under .bin are symlinks, so
    # patch the whole tree to reach the real interpreter lines.
    patchShebangs node_modules
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
