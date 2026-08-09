import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MAP = {
  'darwin-arm64':  { target: 'bun-darwin-arm64',  name: 'rexadb-server-aarch64-apple-darwin' },
  'darwin-x64':    { target: 'bun-darwin-x64',    name: 'rexadb-server-x86_64-apple-darwin' },
  'linux-x64':     { target: 'bun-linux-x64',     name: 'rexadb-server-x86_64-unknown-linux-gnu' },
  'linux-arm64':   { target: 'bun-linux-arm64',   name: 'rexadb-server-aarch64-unknown-linux-gnu' },
  'win32-x64':     { target: 'bun-windows-x64',   name: 'rexadb-server-x86_64-pc-windows-msvc.exe' },
};

const platform = process.platform;
const arch = process.arch;
const key = `${platform}-${arch}`;
const entry = MAP[key];

if (!entry) {
  console.error(`[build-server] Unsupported platform: ${key}`);
  console.error(`  Supported: ${Object.keys(MAP).join(', ')}`);
  process.exit(1);
}

const outDir = join(ROOT, 'src-tauri', 'binaries');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const outfile = join(outDir, entry.name);
const source = join(ROOT, 'server', 'index.ts');

console.log(`[build-server] Building for ${key}`);
console.log(`  target:  ${entry.target}`);
console.log(`  outfile: ${outfile}`);

const result = spawnSync('bun', [
  'build', '--compile',
  `--target=${entry.target}`,
  source,
  `--outfile=${outfile}`,
], { stdio: 'inherit', cwd: ROOT });

if (result.status !== 0) {
  console.error(`[build-server] Failed with exit code ${result.status}`);
  process.exit(result.status);
}

console.log(`[build-server] OK — ${entry.name}`);
