export const SETTINGS_SYNC_LOCAL_CHANGED_EVENT = "rexadb:settings-sync-local-changed";
export const SETTINGS_SYNC_APPLIED_EVENT = "rexadb:settings-sync-applied";
export const SETTINGS_SYNC_STATUS_EVENT = "rexadb:settings-sync-status";
export const SETTINGS_SYNC_REQUEST_EVENT = "rexadb:settings-sync-request";

export type SettingsSyncSection =
  | "studioSettings"
  | "appTheme"
  | "editorTheme"
  | "appFontFamily"
  | "keybindings";

export type SettingsSyncPayloadV1 = {
  version: 1;
  studioSettings?: Record<string, unknown>;
  appTheme?: {
    appThemeId: string;
    customAppThemes: string;
  };
  editorTheme?: {
    editorThemeId: string;
    customEditorThemes: string;
  };
  appFontFamily?: string | null;
  keybindings?: Record<string, unknown>;
};

export type SettingsSyncAppliedDetail = {
  payload: SettingsSyncPayloadV1;
  clientUpdatedAt: number;
  source: "pull" | "push-rejected";
};

export type SettingsSyncStatus =
  | "idle"
  | "disabled"
  | "syncing"
  | "synced"
  | "error";

export type SettingsSyncStatusDetail = {
  status: SettingsSyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  enabled: boolean;
};

const DEFAULT_SETTINGS_SYNC_STATUS: SettingsSyncStatusDetail = {
  status: "idle",
  lastSyncedAt: null,
  error: null,
  enabled: false,
};

let lastSettingsSyncStatus: SettingsSyncStatusDetail = DEFAULT_SETTINGS_SYNC_STATUS;

export function getLastSettingsSyncStatus(): SettingsSyncStatusDetail {
  return lastSettingsSyncStatus;
}

export function emitSettingsSyncLocalChanged(section?: SettingsSyncSection) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SETTINGS_SYNC_LOCAL_CHANGED_EVENT, {
      detail: { section: section ?? null, at: Date.now() },
    }),
  );
}

export function emitSettingsSyncApplied(detail: SettingsSyncAppliedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SETTINGS_SYNC_APPLIED_EVENT, { detail }),
  );
}

export function emitSettingsSyncStatus(detail: SettingsSyncStatusDetail) {
  lastSettingsSyncStatus = detail;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SETTINGS_SYNC_STATUS_EVENT, { detail }),
  );
}

export function subscribeSettingsSyncApplied(
  handler: (detail: SettingsSyncAppliedDetail) => void,
) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SettingsSyncAppliedDetail>).detail;
    if (!detail?.payload) return;
    handler(detail);
  };
  window.addEventListener(SETTINGS_SYNC_APPLIED_EVENT, listener);
  return () => window.removeEventListener(SETTINGS_SYNC_APPLIED_EVENT, listener);
}

export function subscribeSettingsSyncLocalChanged(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(SETTINGS_SYNC_LOCAL_CHANGED_EVENT, listener);
  return () =>
    window.removeEventListener(SETTINGS_SYNC_LOCAL_CHANGED_EVENT, listener);
}

export function subscribeSettingsSyncStatus(
  handler: (detail: SettingsSyncStatusDetail) => void,
) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SettingsSyncStatusDetail>).detail;
    if (!detail) return;
    handler(detail);
  };
  window.addEventListener(SETTINGS_SYNC_STATUS_EVENT, listener);
  return () => window.removeEventListener(SETTINGS_SYNC_STATUS_EVENT, listener);
}

export function requestSettingsSyncNow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SETTINGS_SYNC_REQUEST_EVENT));
}

export function subscribeSettingsSyncRequest(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(SETTINGS_SYNC_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SETTINGS_SYNC_REQUEST_EVENT, listener);
}
