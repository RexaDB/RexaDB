import { supabase } from "@/lib/supabase/client";
import type { SettingsSyncPayloadV1 } from "@/lib/studio/settings-sync-events";

export const SETTINGS_SYNC_META_KEY = "rexa-db-settings-sync-meta";

/** Secrets that must stay device-local and never upload. */
export const SETTINGS_SYNC_EXCLUDED_STUDIO_KEYS = [
  "agentApiKey",
] as const;

export type SettingsSyncMeta = {
  clientUpdatedAt: number;
  lastPulledAt: number | null;
  lastPushedAt: number | null;
  remoteClientUpdatedAt: number | null;
};

export type RemoteSettingsSyncRow = {
  user_id: string;
  payload: SettingsSyncPayloadV1;
  client_updated_at: string;
  updated_at: string;
};

export type SaveSettingsSyncResult = {
  applied: boolean;
  user_id: string;
  payload: SettingsSyncPayloadV1;
  client_updated_at: string;
  updated_at: string;
};

export function readSettingsSyncMeta(): SettingsSyncMeta {
  if (typeof window === "undefined") {
    return {
      clientUpdatedAt: 0,
      lastPulledAt: null,
      lastPushedAt: null,
      remoteClientUpdatedAt: null,
    };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_SYNC_META_KEY);
    if (!raw) {
      return {
        clientUpdatedAt: 0,
        lastPulledAt: null,
        lastPushedAt: null,
        remoteClientUpdatedAt: null,
      };
    }
    const parsed = JSON.parse(raw) as Partial<SettingsSyncMeta>;
    return {
      clientUpdatedAt:
        typeof parsed.clientUpdatedAt === "number" ? parsed.clientUpdatedAt : 0,
      lastPulledAt:
        typeof parsed.lastPulledAt === "number" ? parsed.lastPulledAt : null,
      lastPushedAt:
        typeof parsed.lastPushedAt === "number" ? parsed.lastPushedAt : null,
      remoteClientUpdatedAt:
        typeof parsed.remoteClientUpdatedAt === "number"
          ? parsed.remoteClientUpdatedAt
          : null,
    };
  } catch {
    return {
      clientUpdatedAt: 0,
      lastPulledAt: null,
      lastPushedAt: null,
      remoteClientUpdatedAt: null,
    };
  }
}

export function writeSettingsSyncMeta(meta: SettingsSyncMeta) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore quota / private mode
  }
}

export function bumpSettingsSyncClientUpdatedAt(at = Date.now()): SettingsSyncMeta {
  const current = readSettingsSyncMeta();
  const next: SettingsSyncMeta = {
    ...current,
    clientUpdatedAt: Math.max(current.clientUpdatedAt, at),
  };
  writeSettingsSyncMeta(next);
  return next;
}

export function stripSecretsFromStudioSettings(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(settings || {}) };
  for (const key of SETTINGS_SYNC_EXCLUDED_STUDIO_KEYS) {
    delete next[key];
  }
  return next;
}

export function mergeStudioSettingsPreservingSecrets(
  remote: Record<string, unknown> | null | undefined,
  local: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged = { ...(remote || {}) };
  for (const key of SETTINGS_SYNC_EXCLUDED_STUDIO_KEYS) {
    if (local && key in local) {
      merged[key] = local[key];
    } else {
      delete merged[key];
    }
  }
  return merged;
}

export function normalizeSettingsSyncPayload(
  value: unknown,
): SettingsSyncPayloadV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const version = raw.version === 1 ? 1 : 1;

  const payload: SettingsSyncPayloadV1 = { version };

  if (raw.studioSettings && typeof raw.studioSettings === "object" && !Array.isArray(raw.studioSettings)) {
    payload.studioSettings = stripSecretsFromStudioSettings(
      raw.studioSettings as Record<string, unknown>,
    );
  }

  if (raw.appTheme && typeof raw.appTheme === "object" && !Array.isArray(raw.appTheme)) {
    const theme = raw.appTheme as Record<string, unknown>;
    if (typeof theme.appThemeId === "string") {
      payload.appTheme = {
        appThemeId: theme.appThemeId,
        customAppThemes:
          typeof theme.customAppThemes === "string" ? theme.customAppThemes : "[]",
      };
    }
  }

  if (raw.editorTheme && typeof raw.editorTheme === "object" && !Array.isArray(raw.editorTheme)) {
    const theme = raw.editorTheme as Record<string, unknown>;
    if (typeof theme.editorThemeId === "string") {
      payload.editorTheme = {
        editorThemeId: theme.editorThemeId,
        customEditorThemes:
          typeof theme.customEditorThemes === "string"
            ? theme.customEditorThemes
            : "[]",
      };
    }
  }

  if (raw.appFontFamily === null || typeof raw.appFontFamily === "string") {
    payload.appFontFamily = raw.appFontFamily as string | null;
  }

  if (raw.keybindings && typeof raw.keybindings === "object" && !Array.isArray(raw.keybindings)) {
    payload.keybindings = raw.keybindings as Record<string, unknown>;
  }

  return payload;
}

export function parseClientUpdatedAt(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchUserSettingsSync(): Promise<{
  row: RemoteSettingsSyncRow | null;
  error: string | null;
}> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { row: null, error: userError?.message || "Not signed in." };
  }

  const { data, error } = await supabase
    .from("user_settings_sync")
    .select("user_id, payload, client_updated_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Table missing / RLS — surface as soft failure so the app stays usable.
    return { row: null, error: error.message };
  }

  if (!data) return { row: null, error: null };

  const payload = normalizeSettingsSyncPayload(data.payload);
  if (!payload) {
    return { row: null, error: "Invalid remote settings payload." };
  }

  return {
    row: {
      user_id: data.user_id as string,
      payload,
      client_updated_at: data.client_updated_at as string,
      updated_at: data.updated_at as string,
    },
    error: null,
  };
}

export async function saveUserSettingsSync(params: {
  payload: SettingsSyncPayloadV1;
  clientUpdatedAt: number;
}): Promise<{ result: SaveSettingsSyncResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("save_user_settings_sync", {
    p_payload: params.payload,
    p_client_updated_at: new Date(params.clientUpdatedAt).toISOString(),
  });

  if (error) {
    return { result: null, error: error.message };
  }

  if (!data || typeof data !== "object") {
    return { result: null, error: "Empty save_user_settings_sync response." };
  }

  const raw = data as Record<string, unknown>;
  const payload = normalizeSettingsSyncPayload(raw.payload);
  if (!payload) {
    return { result: null, error: "Invalid save_user_settings_sync payload." };
  }

  return {
    result: {
      applied: Boolean(raw.applied),
      user_id: String(raw.user_id ?? ""),
      payload,
      client_updated_at: String(raw.client_updated_at ?? ""),
      updated_at: String(raw.updated_at ?? ""),
    },
    error: null,
  };
}
