/**
 * Settings Migration Engine
 *
 * Detects whether settings exist in SQLite (legacy) and migrates them
 * to the new settings.json file on disk.
 */

import {
  settingsFileExists,
  readSettingsJson,
  writeSettingsJson,
  settingsFileExistsSync,
  type SettingsFile,
  CURRENT_SETTINGS_VERSION,
} from "./file-settings";

const STUDIO_SETTINGS_KEY = "studio_settings";
const APP_THEME_ID_KEY = "app_theme_id";
const CUSTOM_APP_THEMES_KEY = "custom_app_themes";
const EDITOR_THEME_ID_KEY = "editor_theme_id";
const CUSTOM_EDITOR_THEMES_KEY = "custom_editor_themes";
const APP_FONT_FAMILY_KEY = "app_font_family";

/** All known app_settings keys that should be migrated */
const SETTINGS_KEYS = [
  STUDIO_SETTINGS_KEY,
  APP_THEME_ID_KEY,
  CUSTOM_APP_THEMES_KEY,
  EDITOR_THEME_ID_KEY,
  CUSTOM_EDITOR_THEMES_KEY,
  APP_FONT_FAMILY_KEY,
] as const;

export interface MigrationProgress {
  total: number;
  completed: number;
  currentStep: string;
  done: boolean;
  error?: string;
}

export type MigrationCallback = (progress: MigrationProgress) => void;

/**
 * Check whether a SQLite-to-JSON migration is needed.
 * Migrate if: settings.json doesn't exist AND the app_settings table has data.
 *
 * Uses synchronous file check + lazy table creation so it's reliable even on
 * first call before ensureAppStorageTables() has run.
 */
export async function isMigrationNeeded(): Promise<boolean> {
  // Quick sync check — if JSON file exists, no migration needed
  if (settingsFileExistsSync()) {
    return false;
  }

  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    // Ensure the table exists first
    const { ensureAppStorageTables } = await import("./app-admin-actions");
    await ensureAppStorageTables();

    // Check if any of our known keys have data
    const row = await db.get<{ c: number }>(
      sql`SELECT COUNT(*) as c FROM app_settings WHERE key IN (${STUDIO_SETTINGS_KEY}, ${APP_THEME_ID_KEY}, ${CUSTOM_APP_THEMES_KEY}, ${EDITOR_THEME_ID_KEY}, ${CUSTOM_EDITOR_THEMES_KEY}, ${APP_FONT_FAMILY_KEY})`,
    );
    return (row?.c ?? 0) > 0;
  } catch (err) {
    console.error("[settings-migration] Error checking migration status:", err);
    return false;
  }
}

/**
 * Migrate all settings from SQLite to settings.json.
 * Reports progress via callback.
 */
export async function migrateSettingsFromSqlite(
  onProgress?: MigrationCallback,
): Promise<MigrationProgress> {
  const report = (completed: number, total: number, currentStep: string) => {
    const progress: MigrationProgress = { total, completed, currentStep, done: false };
    onProgress?.(progress);
    return progress;
  };

  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    const total = SETTINGS_KEYS.length + 2; // keys + write + verify
    let completed = 0;

    report(completed, total, "Checking database...");

    // Read all settings from SQLite using the same template pattern as rest of codebase
    const rows = await db.all<{ key: string; value: string | null }>(
      sql`SELECT key, value FROM app_settings WHERE key IN (${STUDIO_SETTINGS_KEY}, ${APP_THEME_ID_KEY}, ${CUSTOM_APP_THEMES_KEY}, ${EDITOR_THEME_ID_KEY}, ${CUSTOM_EDITOR_THEMES_KEY}, ${APP_FONT_FAMILY_KEY})`,
    );

    const settingsMap = new Map<string, string | null>();
    for (const row of rows) {
      settingsMap.set(row.key, row.value);
    }

    // Build the settings file object
    const fileData: SettingsFile = {
      _version: CURRENT_SETTINGS_VERSION,
      _migrated: true,
    };

    // Migrate each key
    for (const key of SETTINGS_KEYS) {
      completed++;
      const value = settingsMap.get(key);
      report(completed, total, `Migrating ${key}...`);

      switch (key) {
        case STUDIO_SETTINGS_KEY:
          if (value && value.trim()) {
            try {
              fileData.studio_settings = JSON.parse(value);
            } catch {
              fileData.studio_settings = {};
            }
          }
          break;
        case APP_THEME_ID_KEY:
          if (value) fileData.app_theme_id = value;
          break;
        case CUSTOM_APP_THEMES_KEY:
          if (value) fileData.custom_app_themes = value;
          break;
        case EDITOR_THEME_ID_KEY:
          if (value) fileData.editor_theme_id = value;
          break;
        case CUSTOM_EDITOR_THEMES_KEY:
          if (value) fileData.custom_editor_themes = value;
          break;
        case APP_FONT_FAMILY_KEY:
          if (value) fileData.app_font_family = value;
          break;
      }
    }

    // Write to JSON file
    completed++;
    report(completed, total, "Writing settings file...");

    const written = await writeSettingsJson(fileData);
    if (!written) {
      const failProgress: MigrationProgress = {
        total,
        completed,
        currentStep: "Failed to write settings file",
        done: false,
        error: "Could not write settings.json. Check filesystem permissions.",
      };
      onProgress?.(failProgress);
      return failProgress;
    }

    // Verify readback
    completed++;
    report(completed, total, "Verifying migration...");

    const readback = await readSettingsJson();
    if (!readback) {
      const failProgress: MigrationProgress = {
        total,
        completed,
        currentStep: "Verification failed",
        done: false,
        error: "Migrated file could not be read back. Settings remain in SQLite.",
      };
      onProgress?.(failProgress);
      return failProgress;
    }

    const doneProgress: MigrationProgress = {
      total,
      completed,
      currentStep: "Migration complete!",
      done: true,
    };
    onProgress?.(doneProgress);
    return doneProgress;
  } catch (err: any) {
    const errProgress: MigrationProgress = {
      total: 0,
      completed: 0,
      currentStep: "Migration failed",
      done: false,
      error: err.message || "Unknown error during migration",
    };
    onProgress?.(errProgress);
    return errProgress;
  }
}

/**
 * Optionally remove migrated settings from SQLite to save space.
 * Only call after confirming migration was successful.
 */
export async function clearMigratedSqliteSettings(): Promise<boolean> {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await db.run(
      sql`DELETE FROM app_settings WHERE key IN (${STUDIO_SETTINGS_KEY}, ${APP_THEME_ID_KEY}, ${CUSTOM_APP_THEMES_KEY}, ${EDITOR_THEME_ID_KEY}, ${CUSTOM_EDITOR_THEMES_KEY}, ${APP_FONT_FAMILY_KEY})`,
    );
    return true;
  } catch (err) {
    console.error("[settings-migration] Failed to clear SQLite settings:", err);
    return false;
  }
}
