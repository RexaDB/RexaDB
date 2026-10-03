"use client";

import { SettingsMigrationDialog } from "@/components/studio/settings-migration-dialog";
import { useEffect, useState } from "react";

/**
 * Mounted in the root layout. Checks if settings need to be migrated
 * from SQLite to settings.json and shows the migration dialog if needed.
 */
export function SettingsMigrationGate() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/api-base")
      .then((mod) => mod.initApiBase())
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEnabled(true);
      });
    // The sidecar respawns automatically on crash, possibly on a different
    // port. Keep resyncing in the background so the app never stays stuck
    // talking to a stale port for the rest of the session.
    const resync = setInterval(() => {
      void import("@/lib/api-base")
        .then((mod) => mod.refreshApiBase())
        .catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(resync);
    };
  }, []);

  if (!enabled) return null;

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
