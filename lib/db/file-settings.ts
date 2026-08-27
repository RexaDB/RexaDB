/**
 * File-based settings storage.
 *
 * Reads/writes all global app settings from/to a single settings.json file
 * in the OS-appropriate config directory (same as getAppDataDir()).
 *
 * Uses atomic writes (write to .tmp, then rename) to prevent corruption.
 */

const SETTINGS_FILE_NAME = "settings.json";
const TEMP_SUFFIX = ".tmp";

let _appDataDir: string | null = null;

function getAppDataDirSync(): string {
  if (_appDataDir !== null && _appDataDir !== undefined) return _appDataDir;
  const os = require("os");
  const path = require("path");
  const home = os.homedir();
  const platform = process.platform;
  if (platform === "win32") {
    const appData =
      process.env.APPDATA || (home ? `${home}\\AppData\\Roaming` : "");
    _appDataDir = appData ? path.join(appData, "Rexa DB") : path.join("Rexa DB");
  } else if (platform === "darwin") {
    _appDataDir = home
      ? path.join(home, "Library", "Application Support", "Rexa DB")
      : "Rexa DB";
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || (home ? `${home}/.config` : "");
    _appDataDir = xdg ? path.join(xdg, "Rexa DB") : "Rexa DB";
  }
  return _appDataDir as string;
}

export function getSettingsFilePath(): string {
  const path = require("path");
  return path.join(getAppDataDirSync(), SETTINGS_FILE_NAME);
}

export function settingsFileExistsSync(): boolean {
  try {
    const fs = require("fs");
    return fs.existsSync(getSettingsFilePath());
  } catch {
    return false;
  }
}

export async function settingsFileExists(): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    await fs.access(getSettingsFilePath());
    return true;
  } catch {
    return false;
  }
}

export async function readSettingsJson(): Promise<Record<string, any> | null> {
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(getSettingsFilePath(), "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
    console.error("[file-settings] settings.json is not a valid object");
    return null;
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error("[file-settings] Error reading settings.json:", err.message);
    }
    return null;
  }
}

/**
 * Atomically write settings to settings.json.
 * 1. Write to a .tmp file in the same directory.
 * 2. rename() the .tmp to settings.json (atomic on same filesystem).
 */
export async function writeSettingsJson(data: Record<string, any>): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    const path = require("path");
    const dir = getAppDataDirSync();
    const filePath = path.join(dir, SETTINGS_FILE_NAME);
    const tmpPath = filePath + TEMP_SUFFIX;

    // Ensure directory exists
    const fsSync = require("fs");
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }

    // Write to temp file
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, json, "utf-8");

    // Atomic rename
    await fs.rename(tmpPath, filePath);

    return true;
  } catch (err: any) {
    console.error("[file-settings] Error writing settings.json:", err.message);
    return false;
  }
}

// Every save function below (studio settings, app theme, editor theme, font
// family) shares this ONE file — each reads the whole thing, mutates only
// its own top-level key, and writes the whole thing back. Without
// serialization, two saves firing close together (e.g. a layout toggle
// alongside any other settings change) can interleave: B reads before A's
// write lands, then B writes back A's now-stale key, silently reverting it.
// Node/Bun is single-threaded, so chaining every read-modify-write through
// one promise queue is enough to make each one atomic relative to the
// others — no two can ever be "in flight" at once.
let settingsWriteQueue: Promise<void> = Promise.resolve();

/**
 * Serializes a read-modify-write cycle against settings.json. `mutator`
 * receives the current file contents (or `{}` if it doesn't exist/parse)
 * and returns the full object to persist. Use this instead of calling
 * `readSettingsJson`/`writeSettingsJson` directly for any read-then-write
 * sequence, so it can't race with any other queued update.
 */
export function queueSettingsUpdate(
  mutator: (current: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>,
): Promise<boolean> {
  const task = settingsWriteQueue.then(async () => {
    const current = (await readSettingsJson()) || {};
    const next = await mutator(current);
    return writeSettingsJson(next);
  });
  // Keep the queue moving even if this update failed, so one bad write
  // doesn't wedge every save after it.
  settingsWriteQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export interface SettingsFile {
  /** All studio_settings fields in one blob (mirrors the old SQLite key) */
  studio_settings?: Record<string, any>;
  /** App theme selection */
  app_theme_id?: string;
  /** Custom app themes array (JSON string for now) */
  custom_app_themes?: string;
  /** Editor theme selection */
  editor_theme_id?: string;
  /** Custom editor themes array (JSON string for now) */
  custom_editor_themes?: string;
  /** App font family */
  app_font_family?: string;
  /** Marked when migration from SQLite completes */
  _migrated?: boolean;
  /** Schema version for future migrations */
  _version?: number;
}

export const CURRENT_SETTINGS_VERSION = 1;
