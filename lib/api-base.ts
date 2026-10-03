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

// Wrapper that routes API calls through the Express sidecar instead of same-origin.
// Use this instead of raw fetch("/api/...") so calls work in static export AND dev mode.
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const resolved = url.startsWith("http") ? url : `${API_BASE}${url}`;
  return fetch(resolved, init);
}
