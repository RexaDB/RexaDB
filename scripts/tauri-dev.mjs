#!/usr/bin/env bun
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const tauriConfigPath = join(process.cwd(), 'src-tauri', 'tauri.conf.json');

// Read original config
const originalConfig = readFileSync(tauriConfigPath, 'utf-8');
const config = JSON.parse(originalConfig);

// Start server dev server
const serverProcess = spawn('bun', ['run', 'server:dev'], {
  stdio: 'inherit'
});

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
  serverProcess.kill();
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
  serverProcess.kill();
  process.exit(code);
});
