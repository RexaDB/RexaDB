{ pkgs, src, version }:

# Next.js static export (`out/`) built with the project's canonical toolchain
# (bun + bun.lock). Consumed by `nix/rexadb.nix` as Tauri's `frontendDist`.
#
# NOTE on `__noChroot`: the Next build fetches Google Fonts at build time
# (`next/font/google` in `app/layout.tsx`), so a fully sandboxed Linux build
# has no network for that step. `__noChroot` relaxes the sandbox on Linux
# (macOS builds are unsandboxed by default anyway); JS deps stay pinned via
# `bun.lock` + `--frozen-lockfile`. Follow-up: self-host fonts under
# `public/fonts` + `next/font/local`, then drop `__noChroot` and switch to
# `buildNpmPackage`/`fetchNpmDeps` for a fully hermetic build.
pkgs.stdenv.mkDerivation {
  pname = "rexadb-frontend";
  inherit version src;
  __noChroot = true;
  # Explicit work copy: $src is the (read-only) flake tree and bun install
  # must write node_modules next to package.json.
  dontUnpack = true;

  nativeBuildInputs = [ pkgs.bun ];

  buildPhase = ''
    runHook preBuild
    cd "$NIX_BUILD_TOP"
    cp -r "$src" ./work
    chmod -R u+w ./work
    cd ./work
    export HOME=$TMPDIR
    export CI=1
    export NEXT_TELEMETRY_DISABLED=1
    bun install --frozen-lockfile --no-progress
    NODE_ENV=production bun --bun run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cd "$NIX_BUILD_TOP/work"
    cp -r out $out
    runHook postInstall
  '';
}
