import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const isWindows = process.platform === "win32";
const srcName = isWindows ? "rexadb-oracle-bridge.exe" : "rexadb-oracle-bridge";
// Tauri resource target keeps the platform-correct filename so the Windows
// lookup (which expects the .exe suffix) resolves on every OS.
const destName = srcName;

console.log("[build-oracle-bridge] Building release bridge...");
const build = spawnSync(
  "cargo",
  ["build", "--release", "--manifest-path", "src-tauri/oracle-bridge/Cargo.toml"],
  { stdio: "inherit", cwd: ROOT },
);
if (build.status !== 0) {
  console.error(`[build-oracle-bridge] cargo build failed (${build.status})`);
  process.exit(build.status ?? 1);
}

const src = join(ROOT, "src-tauri", "oracle-bridge", "target", "release", srcName);
if (!existsSync(src)) {
  console.error(`[build-oracle-bridge] Missing output: ${src}`);
  process.exit(1);
}

const outDir = join(ROOT, "resources", "oracle-bridge");
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, destName);
copyFileSync(src, dest);
if (!isWindows) chmodSync(dest, 0o755);
console.log(`[build-oracle-bridge] OK — ${dest}`);
