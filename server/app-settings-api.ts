import { Effect } from "effect";
import { DbError } from "./effect/errors";

type AppSettingsActionNames =
  | "getAppFontFamily"
  | "saveAppFontFamily"
  | "getGlobalAppThemeSettings"
  | "saveGlobalAppThemeSettings"
  | "getGlobalEditorThemeSettings"
  | "saveGlobalEditorThemeSettings"
  | "getGlobalStudioSettings"
  | "saveGlobalStudioSettings"
  | "isMigrationNeeded"
  | "migrateSettingsFromSqlite"
  | "clearMigratedSqliteSettings";

type AppSettingsActions = Pick<typeof import("../lib/db/actions-core"), AppSettingsActionNames>;

function fromSettingsAction<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

/** Effect facade for app-wide settings and legacy settings migration. */
export function createAppSettingsEffects(actions: AppSettingsActions) {
  return {
    getFontFamily: (...args: Parameters<AppSettingsActions["getAppFontFamily"]>) => fromSettingsAction(
      "Failed to read app font setting",
      () => actions.getAppFontFamily(...args),
    ),
    saveFontFamily: (...args: Parameters<AppSettingsActions["saveAppFontFamily"]>) => fromSettingsAction(
      "Failed to save app font setting",
      () => actions.saveAppFontFamily(...args),
    ),
    getAppTheme: (...args: Parameters<AppSettingsActions["getGlobalAppThemeSettings"]>) => fromSettingsAction(
      "Failed to read app theme settings",
      () => actions.getGlobalAppThemeSettings(...args),
    ),
    saveAppTheme: (...args: Parameters<AppSettingsActions["saveGlobalAppThemeSettings"]>) => fromSettingsAction(
      "Failed to save app theme settings",
      () => actions.saveGlobalAppThemeSettings(...args),
    ),
    getEditorTheme: (...args: Parameters<AppSettingsActions["getGlobalEditorThemeSettings"]>) => fromSettingsAction(
      "Failed to read editor theme settings",
      () => actions.getGlobalEditorThemeSettings(...args),
    ),
    saveEditorTheme: (...args: Parameters<AppSettingsActions["saveGlobalEditorThemeSettings"]>) => fromSettingsAction(
      "Failed to save editor theme settings",
      () => actions.saveGlobalEditorThemeSettings(...args),
    ),
    getStudioSettings: (...args: Parameters<AppSettingsActions["getGlobalStudioSettings"]>) => fromSettingsAction(
      "Failed to read global Studio settings",
      () => actions.getGlobalStudioSettings(...args),
    ),
    saveStudioSettings: (...args: Parameters<AppSettingsActions["saveGlobalStudioSettings"]>) => fromSettingsAction(
      "Failed to save global Studio settings",
      () => actions.saveGlobalStudioSettings(...args),
    ),
    isMigrationNeeded: (...args: Parameters<AppSettingsActions["isMigrationNeeded"]>) => fromSettingsAction(
      "Failed to read settings migration status",
      () => actions.isMigrationNeeded(...args),
    ),
    migrateSettings: (...args: Parameters<AppSettingsActions["migrateSettingsFromSqlite"]>) => fromSettingsAction(
      "Failed to migrate settings",
      () => actions.migrateSettingsFromSqlite(...args),
    ),
    clearMigratedSettings: (...args: Parameters<AppSettingsActions["clearMigratedSqliteSettings"]>) => fromSettingsAction(
      "Failed to clear migrated settings",
      () => actions.clearMigratedSqliteSettings(...args),
    ),
  };
}
