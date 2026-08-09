"use client";

import { SettingsMigrationDialog } from "@/components/studio/settings-migration-dialog";

/**
 * Mounted in the root layout. Checks if settings need to be migrated
 * from SQLite to settings.json and shows the migration dialog if needed.
 */
export function SettingsMigrationGate() {
  return (
    <SettingsMigrationDialog
      onComplete={() => {
        // After migration completes, reload the page so all hooks
        // re-fetch settings from the new JSON file
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }}
      onDismiss={() => {
        // User chose not to migrate; the app will still work via SQLite
        console.log("[SettingsMigration] User dismissed migration dialog");
      }}
    />
  );
}
