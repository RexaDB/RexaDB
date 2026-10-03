// API base URL for the sidecar server (used in static export mode)
// Exported as let so Tauri runtime can update it after port discovery
export let API_BASE = `http://127.0.0.1:3867`;
let initialization: Promise<void> | undefined;

/** Call once at app startup to discover actual sidecar port from Tauri */
export function initApiBase(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const url = await invoke<string>('get_api_base_url');
        if (url) API_BASE = url;
      } catch {
        // not running inside Tauri; keep default
      }
    })();
  }
  return initialization;
}

// Wrapper that routes API calls through the Express sidecar instead of same-origin.
// Use this instead of raw fetch("/api/...") so calls work in static export AND dev mode.
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const resolved = url.startsWith("http") ? url : `${API_BASE}${url}`;
  return fetch(resolved, init);
}
