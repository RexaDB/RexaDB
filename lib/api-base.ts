// API base URL for the sidecar server (used in static export mode)
// Exported as let so Tauri runtime can update it after port discovery
export let API_BASE = `http://127.0.0.1:3867`;
let initialization: Promise<void> | undefined;

async function discoverApiBase(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const url = await invoke<string>('get_api_base_url');
    if (url) API_BASE = url;
  } catch {
    // not running inside Tauri; keep default. Reset the cached promise so a
    // later retry (e.g. after the sidecar finishes starting) can try again
    // instead of caching the failure for the rest of the session.
    initialization = undefined;
  }
}

/** Call once at app startup to discover actual sidecar port from Tauri */
export function initApiBase(): Promise<void> {
  if (!initialization) {
    initialization = discoverApiBase();
  }
  return initialization;
}

/**
 * Force re-discovery of the sidecar port. The sidecar respawns automatically
 * on crash, possibly on a different port, so callers should resync
 * periodically (see SettingsMigrationGate) instead of trusting the first
 * discovery for the whole session.
 */
export function refreshApiBase(): Promise<void> {
  initialization = discoverApiBase();
  return initialization;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeSidecarHttp(timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort check: is the sidecar reachable right now?
 * In Tauri this prefers the Rust `is_sidecar_ready` flag (which also
 * re-syncs the dynamic port); in a plain browser it probes /health.
 * The HTTP probe is bounded by `timeoutMs` so a local service that
 * accepts without replying can't hang the caller. Never throws.
 */
export async function isSidecarReady(
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const ok = await invoke<boolean>("is_sidecar_ready");
      if (ok) {
        await initApiBase().catch(() => undefined);
        return true;
      }
    } catch {
      // Tauri import worked but the command failed — fall through to HTTP probe.
    }
  } catch {
    // Not running inside Tauri — fall through to HTTP probe.
  }
  return probeSidecarHttp(timeoutMs);
}

/**
 * Wait until the sidecar answers (or timeout). Used to avoid a one-shot
 * initial fetch racing a slow cold-start sidecar and caching an empty list
 * for the whole session. Never throws; returns false on timeout.
 */
export async function waitForSidecarReady(
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  // Make sure we have at least attempted port discovery before probing.
  await initApiBase().catch(() => undefined);
  let attempts = 0;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // Bound each probe by the remaining budget so the overall wait never
    // exceeds timeoutMs, even if a local service accepts without replying.
    if (await isSidecarReady({ timeoutMs: Math.min(remaining, 5000) })) {
      return true;
    }
    if (Date.now() >= deadline) return false;
    attempts += 1;
    // The sidecar may have respawned on a new port while we poll.
    if (attempts % 3 === 0) {
      await refreshApiBase().catch(() => undefined);
    }
    await sleep(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
}

// Wrapper that routes API calls through the Express sidecar instead of same-origin.
// Use this instead of raw fetch("/api/...") so calls work in static export AND dev mode.
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const resolved = url.startsWith("http") ? url : `${API_BASE}${url}`;
  return fetch(resolved, init);
}
