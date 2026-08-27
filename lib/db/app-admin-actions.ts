import {
  settingsFileExists,
  readSettingsJson,
  queueSettingsUpdate,
} from "./file-settings";
import { isPostgresConnection } from "./pg-connection";
import {
  getPgHost,
  getPgPort,
  getPgDatabase,
  getPgUsername,
  getPgPassword,
  getPgSslConfig,
} from "./pg-connection";
import {
  isLikelySupabaseConnection,
  isSupabaseExcludedSchema,
} from "./supabase-helpers";
import { formatDbError } from "./sqlite-helpers";
import { resetAndApplySql, importDatabaseBundle } from "./export-helpers";

const APP_FONT_FAMILY_KEY = "app_font_family";
const APP_THEME_ID_KEY = "app_theme_id";
const CUSTOM_APP_THEMES_KEY = "custom_app_themes";
const EDITOR_THEME_ID_KEY = "editor_theme_id";
const CUSTOM_EDITOR_THEMES_KEY = "custom_editor_themes";
const STUDIO_SETTINGS_KEY = "studio_settings";

export async function ensureAppStorageTables() {
  const { db } = await import("./index");
  const { sql } = await import("drizzle-orm");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
}

export async function getAppFontFamily(ensureCoreTables: () => Promise<void>) {
  try {
    // Try JSON file first
    if (await settingsFileExists()) {
      const fileData = await readSettingsJson();
      if (fileData && typeof fileData.app_font_family === "string") {
        return { success: true, data: fileData.app_font_family };
      }
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const rows = await db.all<{ value: string | null }>(sql`
      SELECT value
      FROM app_settings
      WHERE key = ${APP_FONT_FAMILY_KEY}
      LIMIT 1
    `);

    const savedValue = rows[0]?.value?.trim();
    if (savedValue) {
      return { success: true, data: savedValue };
    }

    await ensureCoreTables();
    const columns = await db.all<{ name?: string }>(
      sql`PRAGMA table_info(connection_settings)`,
    );
    const hasLegacyColumn = columns.some(
      (column) =>
        String(column?.name || "")
          .trim()
          .toLowerCase() === "custom_font_family",
    );
    if (!hasLegacyColumn) {
      return { success: true, data: "" };
    }

    const legacyRows = await db.all<{ value: string | null }>(sql`
      SELECT custom_font_family AS value
      FROM connection_settings
      WHERE TRIM(COALESCE(custom_font_family, '')) <> ''
      LIMIT 1
    `);
    const legacyValue = legacyRows[0]?.value?.trim();
    if (!legacyValue) {
      return { success: true, data: "" };
    }

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${APP_FONT_FAMILY_KEY}, ${legacyValue}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true, data: legacyValue };
  } catch (error: any) {
    console.error("Failed to fetch app font family:", error);
    return { success: false, error: error.message };
  }
}

export async function saveAppFontFamily(fontFamily: string | null) {
  try {
    // If JSON file exists (migration already happened), write to JSON
    if (await settingsFileExists()) {
      const written = await queueSettingsUpdate((fileData) => {
        const normalized = typeof fontFamily === "string" ? fontFamily.trim() : "";
        if (!normalized) {
          delete fileData.app_font_family;
        } else {
          fileData.app_font_family = normalized;
        }
        fileData._version = 1;
        return fileData;
      });
      if (written) return { success: true };
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const normalized = typeof fontFamily === "string" ? fontFamily.trim() : "";

    await ensureAppStorageTables();
    if (!normalized) {
      await db.run(
        sql`DELETE FROM app_settings WHERE key = ${APP_FONT_FAMILY_KEY}`,
      );
      return { success: true };
    }

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${APP_FONT_FAMILY_KEY}, ${normalized}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save app font family:", error);
    return { success: false, error: error.message };
  }
}

async function checkMissingSettingColumns(db: any, sql: any, columns: string[]): Promise<boolean> {
  const cols = await db.all(
    sql`PRAGMA table_info(connection_settings)`,
  ) as { name?: string }[];
  const existingColumns = new Set(
    cols
      .map((column: { name?: string }) =>
        String(column?.name || "").trim().toLowerCase(),
      )
      .filter(Boolean),
  );
  return columns.every((col) => !existingColumns.has(col));
}

export async function getGlobalAppThemeSettings(
  ensureCoreTables: () => Promise<void>,
) {
  try {
    // Try JSON file first
    if (await settingsFileExists()) {
      const fileData = await readSettingsJson();
      if (fileData) {
        return {
          success: true,
          data: {
            appThemeId: fileData.app_theme_id || "zinc-dark-white",
            customAppThemes: fileData.custom_app_themes || "[]",
          },
        };
      }
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const rows = await db.all<{ key: string; value: string | null }>(sql`
      SELECT key, value
      FROM app_settings
      WHERE key IN (${APP_THEME_ID_KEY}, ${CUSTOM_APP_THEMES_KEY})
    `);

    const savedThemeId =
      rows.find((row) => row.key === APP_THEME_ID_KEY)?.value?.trim() || "";
    const savedCustomThemes =
      rows.find((row) => row.key === CUSTOM_APP_THEMES_KEY)?.value?.trim() ||
      "";
    if (savedThemeId || savedCustomThemes) {
      return {
        success: true,
        data: {
          appThemeId: savedThemeId || "zinc-dark-white",
          customAppThemes: savedCustomThemes || "[]",
        },
      };
    }

    const missingSetting = await checkMissingSettingColumns(db, sql, ["app_theme_id", "custom_app_themes"]);
    if (missingSetting) {
      return { success: true, data: { appThemeId: "zinc-dark-white", customAppThemes: "[]" } };
    }

    const legacyRows = await db.all<{
      appThemeId?: string | null;
      customAppThemes?: string | null;
    }>(sql`
      SELECT app_theme_id AS appThemeId, custom_app_themes AS customAppThemes
      FROM connection_settings
      WHERE TRIM(COALESCE(app_theme_id, '')) <> ''
         OR TRIM(COALESCE(custom_app_themes, '')) <> ''
      LIMIT 1
    `);
    const legacyThemeId = legacyRows[0]?.appThemeId?.trim() || "zinc-dark-white";
    const legacyCustomThemes = legacyRows[0]?.customAppThemes?.trim() || "[]";

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${APP_THEME_ID_KEY}, ${legacyThemeId}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${CUSTOM_APP_THEMES_KEY}, ${legacyCustomThemes}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return {
      success: true,
      data: {
        appThemeId: legacyThemeId,
        customAppThemes: legacyCustomThemes,
      },
    };
  } catch (error: any) {
    console.error("Failed to fetch global app theme settings:", error);
    return { success: false, error: error.message };
  }
}

export async function saveGlobalAppThemeSettings(settings: {
  appThemeId: string;
  customAppThemes: string;
}) {
  try {
    // If JSON file exists (migration already happened), write to JSON
    if (await settingsFileExists()) {
      const written = await queueSettingsUpdate((fileData) => {
        fileData.app_theme_id = String(settings.appThemeId || "zinc-dark-white").trim() || "zinc-dark-white";
        // fallow-ignore-next-line code-duplication
        fileData.custom_app_themes = String(settings.customAppThemes || "[]").trim() || "[]";
        fileData._version = 1;
        return fileData;
      });
      if (written) return { success: true };
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const appThemeId =
      String(settings.appThemeId || "zinc-dark-white").trim() || "zinc-dark-white";
    const customAppThemes =
      String(settings.customAppThemes || "[]").trim() || "[]";
    const updatedAt = Date.now();

    await ensureAppStorageTables();
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${APP_THEME_ID_KEY}, ${appThemeId}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${CUSTOM_APP_THEMES_KEY}, ${customAppThemes}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save global app theme settings:", error);
    return { success: false, error: error.message };
  }
}

export async function getGlobalEditorThemeSettings(
  ensureCoreTables: () => Promise<void>,
) {
  try {
    // Try JSON file first
    if (await settingsFileExists()) {
      const fileData = await readSettingsJson();
      if (fileData) {
        return {
          success: true,
          data: {
            editorThemeId: fileData.editor_theme_id || "auto",
            customEditorThemes: fileData.custom_editor_themes || "[]",
          },
        };
      }
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const rows = await db.all<{ key: string; value: string | null }>(sql`
      SELECT key, value
      FROM app_settings
      WHERE key IN (${EDITOR_THEME_ID_KEY}, ${CUSTOM_EDITOR_THEMES_KEY})
    `);

    const savedThemeId =
      rows.find((row) => row.key === EDITOR_THEME_ID_KEY)?.value?.trim() || "";
    const savedCustomThemes =
      rows.find((row) => row.key === CUSTOM_EDITOR_THEMES_KEY)?.value?.trim() ||
      "";
    if (savedThemeId || savedCustomThemes) {
      return {
        success: true,
        data: {
          editorThemeId: savedThemeId || "auto",
          customEditorThemes: savedCustomThemes || "[]",
        },
      };
    }

    const missingSetting = await checkMissingSettingColumns(db, sql, ["editor_theme_id", "custom_editor_themes"]);
    if (missingSetting) {
      return { success: true, data: { editorThemeId: "auto", customEditorThemes: "[]" } };
    }

    const legacyRows = await db.all<{
      editorThemeId?: string | null;
      customEditorThemes?: string | null;
    }>(sql`
      SELECT editor_theme_id AS editorThemeId, custom_editor_themes AS customEditorThemes
      FROM connection_settings
      WHERE TRIM(COALESCE(editor_theme_id, '')) <> ''
         OR TRIM(COALESCE(custom_editor_themes, '')) <> ''
      LIMIT 1
    `);
    const legacyThemeId = legacyRows[0]?.editorThemeId?.trim() || "auto";
    const legacyCustomThemes =
      legacyRows[0]?.customEditorThemes?.trim() || "[]";

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${EDITOR_THEME_ID_KEY}, ${legacyThemeId}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${CUSTOM_EDITOR_THEMES_KEY}, ${legacyCustomThemes}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return {
      success: true,
      data: {
        editorThemeId: legacyThemeId,
        customEditorThemes: legacyCustomThemes,
      },
    };
  } catch (error: any) {
    console.error("Failed to fetch global editor theme settings:", error);
    return { success: false, error: error.message };
  }
}

export async function saveGlobalEditorThemeSettings(settings: {
  editorThemeId: string;
  customEditorThemes: string;
}) {
  try {
    // If JSON file exists (migration already happened), write to JSON
    if (await settingsFileExists()) {
      const written = await queueSettingsUpdate((fileData) => {
        fileData.editor_theme_id = String(settings.editorThemeId || "auto").trim() || "auto";
        // fallow-ignore-next-line code-duplication
        fileData.custom_editor_themes = String(settings.customEditorThemes || "[]").trim() || "[]";
        fileData._version = 1;
        return fileData;
      });
      if (written) return { success: true };
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const editorThemeId =
      String(settings.editorThemeId || "auto").trim() || "auto";
    const customEditorThemes =
      String(settings.customEditorThemes || "[]").trim() || "[]";
    const updatedAt = Date.now();

    await ensureAppStorageTables();
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${EDITOR_THEME_ID_KEY}, ${editorThemeId}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${CUSTOM_EDITOR_THEMES_KEY}, ${customEditorThemes}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save global editor theme settings:", error);
    return { success: false, error: error.message };
  }
}

export async function getGlobalStudioSettings(
  ensureCoreTables: () => Promise<void>,
) {
  try {
    // Try JSON file first
    if (await settingsFileExists()) {
      const fileData = await readSettingsJson();
      if (fileData?.studio_settings) {
        return { success: true, data: fileData.studio_settings };
      }
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");

    await ensureAppStorageTables();
    const rows = await db.all<{ key: string; value: string | null }>(sql`
      SELECT key, value
      FROM app_settings
      WHERE key = ${STUDIO_SETTINGS_KEY}
    `);

    const savedSettings = rows[0]?.value?.trim() || "";
    if (savedSettings) {
      try {
        return {
          success: true,
          data: JSON.parse(savedSettings),
        };
      } catch {
        // Fallback to legacy
      }
    }

    await ensureCoreTables();
    const legacyRows = await db.all<{ settings_json?: string | null }>(sql`
      SELECT settings_json
      FROM connection_settings
      WHERE TRIM(COALESCE(settings_json, '')) <> ''
      LIMIT 1
    `);
    const legacySettings = legacyRows[0]?.settings_json?.trim() || "{}";

    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${STUDIO_SETTINGS_KEY}, ${legacySettings}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return {
      success: true,
      data: JSON.parse(legacySettings),
    };
  } catch (error: any) {
    console.error("Failed to fetch global studio settings:", error);
    return { success: false, error: error.message };
  }
}

export async function saveGlobalStudioSettings(settings: Record<string, any>) {
  try {
    // If JSON file exists (migration already happened), write to JSON
    if (await settingsFileExists()) {
      const written = await queueSettingsUpdate((fileData) => {
        fileData.studio_settings = settings;
        fileData._version = 1;
        return fileData;
      });
      if (written) return { success: true };
      // Fall through to SQLite on write failure
    }

    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const settingsJson = JSON.stringify(settings);
    const updatedAt = Date.now();

    await ensureAppStorageTables();
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${STUDIO_SETTINGS_KEY}, ${settingsJson}, ${updatedAt})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save global studio settings:", error);
    return { success: false, error: error.message };
  }
}

const CONNECTION_WORKSPACE_KEY_PREFIX = "connection_workspace_id:";

export async function getConnectionWorkspaceId(connectionId: number) {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const key = `${CONNECTION_WORKSPACE_KEY_PREFIX}${connectionId}`;

    await ensureAppStorageTables();
    const rows = await db.all<{ value: string | null }>(sql`
      SELECT value
      FROM app_settings
      WHERE key = ${key}
      LIMIT 1
    `);

    const value = rows[0]?.value?.trim();
    return { success: true, data: value || null };
  } catch (error: any) {
    console.error("Failed to fetch connection workspace id:", error);
    return { success: false, error: error.message };
  }
}

export async function saveConnectionWorkspaceId(
  connectionId: number,
  workspaceId: string | null,
) {
  try {
    const { db } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const key = `${CONNECTION_WORKSPACE_KEY_PREFIX}${connectionId}`;

    await ensureAppStorageTables();
    await db.run(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${workspaceId || ""}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    return { success: true };
  } catch (error: any) {
    console.error("Failed to save connection workspace id:", error);
    return { success: false, error: error.message };
  }
}


