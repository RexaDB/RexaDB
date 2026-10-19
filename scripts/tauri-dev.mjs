#!/usr/bin/env bun
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const tauriConfigPath = join(process.cwd(), 'src-tauri', 'tauri.conf.json');

// Tauri validates bundle.resources at compile time and dist/ is gitignored,
// so ensure the JDBC bridge (bridge.jar + JRE) exists before launching.
{
  const { spawnSync } = await import('child_process');
  const { existsSync } = await import('fs');
  const bridgeJar = join(process.cwd(), 'resources', 'java-bridge', 'dist', 'bridge.jar');
  // Native Windows JREs ship java.exe, not java.
  const javaBin = process.platform === 'win32' ? 'java.exe' : 'java';
  const jreJava = join(process.cwd(), 'resources', 'java-bridge', 'dist', 'jre', 'bin', javaBin);
  if (!existsSync(bridgeJar) || !existsSync(jreJava)) {
    console.log('[Tauri Dev] Java bridge artifacts missing, building...');
    const build = spawnSync('bun', ['run', 'scripts/build-java-bridge.mjs'], { stdio: 'inherit' });
    if (build.status !== 0) {
      console.error('[Tauri Dev] Java bridge build failed — aborting.');
      process.exit(build.status ?? 1);
    }
  }
}

// Read original config
const originalConfig = readFileSync(tauriConfigPath, 'utf-8');
const config = JSON.parse(originalConfig);

// Start Next.js dev server
const nextProcess = spawn('bun', ['run', 'dev'], {
  stdio: ['inherit', 'pipe', 'inherit']
});

let devPort = 3000; // default

// Parse the port from Next.js output
nextProcess.stdout.on('data', (data) => {
  const output = data.toString();
  const portMatch = output.match(/- Local:\s+http:\/\/localhost:(\d+)/);
  if (portMatch) {
    devPort = portMatch[1];
    console.log(`\n[Tauri Dev] Next.js running on port ${devPort}`);
  }
});

// Wait for Next.js to start
await setTimeout(3000);

// Update config with detected port
config.build.devUrl = `http://localhost:${devPort}`;
writeFileSync(tauriConfigPath, JSON.stringify(config, null, 2));

// Start Tauri
const tauriProcess = spawn('tauri', ['dev'], {
  stdio: 'inherit'
});

// Handle cleanup
const cleanup = () => {
  nextProcess.kill();
  tauriProcess.kill();
  // Restore original config
  writeFileSync(tauriConfigPath, originalConfig);
  process.exit();
};

process.on('SIGINT', cleanup);
tauriProcess.on('close', (code) => {
  // Restore original config
  writeFileSync(tauriConfigPath, originalConfig);
  nextProcess.kill();
  process.exit(code);
});
