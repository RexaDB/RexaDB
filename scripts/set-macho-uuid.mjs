// `bun build --compile` keeps the LC_UUID of the Bun runtime it copies, so every
// program compiled with the same Bun version shares one Mach-O UUID. macOS Local
// Network privacy identifies executables by that UUID (Apple TN3179), and a
// shared one can leave the sidecar blocked even when RexaDB is allowed.
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const MH_MAGIC_64 = 0xfeedfacf;
const LC_UUID = 0x1b;
const MACH_HEADER_64_SIZE = 32;

/** Replaces LC_UUID in a thin 64-bit Mach-O with a hash of its contents. */
export function setUniqueMachoUuid(binary) {
  if (binary.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error('not a thin 64-bit Mach-O');
  }
  const commandCount = binary.readUInt32LE(16);
  let offset = MACH_HEADER_64_SIZE;
  for (let i = 0; i < commandCount; i++) {
    if (binary.readUInt32LE(offset) === LC_UUID) {
      const uuid = createHash('sha256').update(binary).digest().subarray(0, 16);
      uuid[6] = (uuid[6] & 0x0f) | 0x40;
      uuid[8] = (uuid[8] & 0x3f) | 0x80;
      uuid.copy(binary, offset + 8);
      return uuid.toString('hex');
    }
    offset += binary.readUInt32LE(offset + 4);
  }
  throw new Error('no LC_UUID load command');
}

/** Rewrites the file's UUID and re-signs it, since the edit voids its signature. */
export function setUniqueMachoUuidInFile(file) {
  const binary = readFileSync(file);
  const uuid = setUniqueMachoUuid(binary);
  writeFileSync(file, binary);
  const signed = spawnSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' });
  if (signed.status !== 0) {
    throw new Error(`codesign failed with exit code ${signed.status}`);
  }
  console.log(`[set-macho-uuid] ${file}: ${uuid}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of process.argv.slice(2)) setUniqueMachoUuidInFile(file);
}
