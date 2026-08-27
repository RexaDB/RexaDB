import fs from "fs";
import os from "os";
import path from "path";
import type { AgentProvider } from "./provider-types";
import type { ProvidersCachePayload } from "./provider-cache";

function getCachePath(): string {
  // Mirror t3's baseDir/caches: use ~/.cache/rexadb or XDG_CACHE_HOME or tmpdir fallback
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  if (xdg) {
    try {
      const dir = path.join(xdg, "rexadb");
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, "providers-cache.json");
    } catch {}
  }
  try {
    const dir = path.join(os.homedir(), ".cache", "rexadb");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "providers-cache.json");
  } catch {}
  // Fallback to tmpdir (ephemeral but still instant within same boot)
  try {
    const dir = path.join(os.tmpdir(), "rexadb-cache");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "providers-cache.json");
  } catch {}
  return path.join(os.tmpdir(), "rexadb-providers-cache.json");
}

let memoryCache: ProvidersCachePayload | null = null;
let memoryCachePath: string | null = null;

export function readServerProviderCache(): ProvidersCachePayload | null {
  if (memoryCache) return memoryCache;
  try {
    const p = getCachePath();
    memoryCachePath = p;
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as ProvidersCachePayload;
    if (!Array.isArray(data.providers) || typeof data.cachedAt !== "number") return null;
    memoryCache = data;
    return data;
  } catch {
    return null;
  }
}

export function writeServerProviderCache(providers: AgentProvider[]): void {
  const payload: ProvidersCachePayload = { providers, cachedAt: Date.now() };
  memoryCache = payload;
  try {
    const p = memoryCachePath ?? getCachePath();
    memoryCachePath = p;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Don't write updateState etc, just providers as-is
    fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  } catch {}
}

export function getServerCachePathForLog(): string {
  try {
    return getCachePath();
  } catch {
    return "(unknown)";
  }
}
