#!/usr/bin/env bun
/**
 * make-test-update.mjs
 *
 * Generate a candidate `latest.json` that points at a LOCAL update server
 * (http://127.0.0.1:PORT) instead of the live GitHub release.
 *
 * This lets you test the in-app updater (check -> download -> install -> restart)
 * without touching production, using the signed bundles already present in
 * release-v1.3.4/.
 *
 * Takes a base version directory and an optional target "available" version.
 * The resulting latest.json is written to the chosen update-server root dir
 * (default: ./update-test-root), which the update-test-server.mjs script serves.
 *
 * Usage:
 *   bun run scripts/make-test-update.mjs [--version 1.3.5] [--root ./update-test-root]
 *
 * Flags:
 *   --version <v>   version to advertise as "available" (default: 1.3.4)
 *   --root <dir>    where to place latest.json + copied bundles (default: ./update-test-root)
 *   --port <port>   port the server will run on, used in URLs (default: 38472)
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const opts = parseArgs({
  options: {
    version: { type: "string", default: "1.3.4" },
    root: { type: "string", default: "update-test-root" },
    port: { type: "string", default: "38472" },
    base: { type: "string", default: "release-v1.3.4" },
    help: { type: "boolean", default: false },
  },
}).values;

if (opts.help) {
  console.log(`Usage: bun run scripts/make-test-update.mjs [--version 1.3.5] [--root ./update-test-root] [--port 38472]`);
  process.exit(0);
}

const VER = opts.version;
const BASE_DIR = resolve(PROJECT_ROOT, opts.base);
const OUT_DIR = resolve(PROJECT_ROOT, opts.root);
const PORT = opts.port;
const BASE_URL = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT_DIR, { recursive: true });

function readSig(file) {
  return readFileSync(join(BASE_DIR, file), "utf8").trim();
}

function copyAsset(file, destName) {
  copyFileSync(join(BASE_DIR, file), join(OUT_DIR, destName));
}

// Copy the signed bundles + signatures that the manifest will reference.
copyAsset(`RexaDB_${VER}_aarch64.app.tar.gz`, `RexaDB_${VER}_aarch64.app.tar.gz`);
copyAsset(`RexaDB_${VER}_aarch64.app.tar.gz.sig`, `RexaDB_${VER}_aarch64.app.tar.gz.sig`);
copyAsset(`RexaDB_${VER}_x64.app.tar.gz`, `RexaDB_${VER}_x64.app.tar.gz`);
copyAsset(`RexaDB_${VER}_x64.app.tar.gz.sig`, `RexaDB_${VER}_x64.app.tar.gz.sig`);
copyAsset(`RexaDB_${VER}_x86_64.AppImage`, `RexaDB_${VER}_x86_64.AppImage`);
copyAsset(`RexaDB_${VER}_x86_64.AppImage.sig`, `RexaDB_${VER}_x86_64.AppImage.sig`);
copyAsset(`RexaDB_${VER}_amd64.deb`, `RexaDB_${VER}_amd64.deb`);
copyAsset(`RexaDB_${VER}_amd64.deb.sig`, `RexaDB_${VER}_amd64.deb.sig`);
copyAsset(`RexaDB_${VER}_x64-setup.exe`, `RexaDB_${VER}_x64-setup.exe`);
copyAsset(`RexaDB_${VER}_x64-setup.exe.sig`, `RexaDB_${VER}_x64-setup.exe.sig`);

const sigArm = readSig(`RexaDB_${VER}_aarch64.app.tar.gz.sig`);
const sigX64 = readSig(`RexaDB_${VER}_x64.app.tar.gz.sig`);
const sigAppImage = readSig(`RexaDB_${VER}_x86_64.AppImage.sig`);
const sigDeb = readSig(`RexaDB_${VER}_amd64.deb.sig`);
const sigExe = readSig(`RexaDB_${VER}_x64-setup.exe.sig`);

const manifest = {
  version: VER,
  notes: `RexaDB ${VER} (LOCAL TEST UPDATE)`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      url: `${BASE_URL}/RexaDB_${VER}_aarch64.app.tar.gz`,
      signature: sigArm,
    },
    "darwin-x86_64": {
      url: `${BASE_URL}/RexaDB_${VER}_x64.app.tar.gz`,
      signature: sigX64,
    },
    "linux-x86_64": {
      url: `${BASE_URL}/RexaDB_${VER}_x86_64.AppImage`,
      signature: sigAppImage,
    },
    "linux-x86_64-appimage": {
      url: `${BASE_URL}/RexaDB_${VER}_x86_64.AppImage`,
      signature: sigAppImage,
    },
    "linux-x86_64-deb": {
      url: `${BASE_URL}/RexaDB_${VER}_amd64.deb`,
      signature: sigDeb,
    },
    "windows-x86_64": {
      url: `${BASE_URL}/RexaDB_${VER}_x64-setup.exe`,
      signature: sigExe,
    },
    "windows-x86_64-nsis": {
      url: `${BASE_URL}/RexaDB_${VER}_x64-setup.exe`,
      signature: sigExe,
    },
  },
};

const manifestPath = join(OUT_DIR, "latest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Wrote local test manifest: ${manifestPath}`);
console.log(`  advertised version : ${VER}`);
console.log(`  bundle base URL    : ${BASE_URL}`);
console.log("");
console.log(`Files served from '${OUT_DIR}':`);
for (const f of ["latest.json", `RexaDB_${VER}_aarch64.app.tar.gz`, `RexaDB_${VER}_aarch64.app.tar.gz.sig`]) {
  console.log(`  ${f}`);
}
console.log("");
console.log(`Next steps:`);
console.log(`  1. Start the local server:  bun run scripts/update-test-server.mjs`);
console.log(`  2. Point tauri.conf.json updater endpoint at:  ${BASE_URL}/latest.json`);
console.log(`  3. Build & run the app, then test check/download/install.`);
