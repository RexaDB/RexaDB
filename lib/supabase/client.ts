import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabasePublishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  );
}

const isTauriRuntime =
  typeof window !== "undefined" &&
  (typeof (window as any).__TAURI__ !== "undefined" ||
    typeof (window as any).__TAURI_INTERNALS__ !== "undefined");

const COOKIE_OPTIONS = "; path=/; SameSite=Lax; Max-Age=31536000";

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTauriAvailable(): boolean {
  return isTauriRuntime;
}

async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke(cmd, args || {});
  } catch {
    return null;
  }
}

function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function removeLocalStorage(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === "undefined") return null;
    try {
      const match = document.cookie.match(
        new RegExp(`(?:^|;\\s*)${escapeRegExp(key)}=([^;]*)`)
      );
      const cookieValue = match ? decodeURIComponent(match[1]) : null;
      if (cookieValue) return cookieValue;

      const legacyValue = readLocalStorage(key);
      if (legacyValue) {
        try {
          document.cookie = `${key}=${encodeURIComponent(legacyValue)}${COOKIE_OPTIONS}`;
        } catch {}
        removeLocalStorage(key);
        return legacyValue;
      }

      return null;
    } catch (error) {
      console.error(`[Supabase] Error reading cookie "${key}":`, error);
      return null;
    }
  },

  setItem(key: string, value: string): void {
    if (typeof document === "undefined") return;
    try {
      document.cookie = `${key}=${encodeURIComponent(value)}${COOKIE_OPTIONS}`;
    } catch (error) {
      console.error(`[Supabase] Error writing cookie "${key}":`, error);
    }
    writeLocalStorage(key, value);
  },

  removeItem(key: string): void {
    if (typeof document === "undefined") return;
    try {
      document.cookie = `${key}=; path=/; Max-Age=0; SameSite=Lax`;
    } catch (error) {
      console.error(`[Supabase] Error removing cookie "${key}":`, error);
    }
    removeLocalStorage(key);
  },
};

const tauriBackedStorage = {
  async getItem(key: string): Promise<string | null> {
    const fallbackValue = cookieStorage.getItem(key);
    if (!isTauriAvailable()) return fallbackValue;

    try {
      const persistedValue = await tauriInvoke("auth_storage_get", { key });
      if (typeof persistedValue === "string") {
        if (persistedValue !== fallbackValue) {
          cookieStorage.setItem(key, persistedValue);
        }
        return persistedValue;
      }

      if (fallbackValue) {
        await tauriInvoke("auth_storage_set", { key, value: fallbackValue });
      }
      return fallbackValue;
    } catch (error) {
      console.error(`[Supabase] Error reading key "${key}" from Tauri auth storage:`, error);
      return fallbackValue;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    cookieStorage.setItem(key, value);
    if (!isTauriAvailable()) return;

    try {
      await tauriInvoke("auth_storage_set", { key, value });
    } catch (error) {
      console.error(`[Supabase] Error writing key "${key}" to Tauri auth storage:`, error);
    }
  },

  async removeItem(key: string): Promise<void> {
    cookieStorage.removeItem(key);
    if (!isTauriAvailable()) return;

    try {
      await tauriInvoke("auth_storage_remove", { key });
    } catch (error) {
      console.error(`[Supabase] Error removing key "${key}" from Tauri auth storage:`, error);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: tauriBackedStorage,
    storageKey: "rexa-db-auth",
    detectSessionInUrl: false,
  },
});
