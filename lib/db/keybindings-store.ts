import fs from "fs";

import { resolveDbPath } from "./db-utils";
import {
  getDefaultKeybindings,
  withMissingDefaultKeybindings,
  type Keybinding,
} from "@/lib/studio/keybindings";

export function getKeybindingsFilePath(): string {
  return resolveDbPath("keybindings.json");
}

function readJsonFile(filePath: string): Record<string, Keybinding> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Keybinding>;
    }
  } catch {
    // Missing file or invalid JSON — caller falls back to migration/defaults.
  }
  return null;
}

function writeJsonFile(filePath: string, data: Record<string, Keybinding>) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * One-time migration for users upgrading from a version that stored
 * keybindings per-connection in the `connection_settings` SQLite table.
 * Keybindings are a personal preference, not a per-connection one, so the
 * first customized set we find becomes the seed for the new global file.
 */
async function migrateFromSqlite(): Promise<Record<string, Keybinding> | null> {
  try {
    const { db } = await import("./index");
    const { connectionSettings } = await import("./schema");
    const { ensureCoreTables } = await import("./ensure-core-tables");
    await ensureCoreTables();
    const rows = await db.select().from(connectionSettings);
    for (const row of rows) {
      if (!row.keybindings) continue;
      try {
        const parsed = JSON.parse(row.keybindings);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.keys(parsed).length > 0
        ) {
          return parsed as Record<string, Keybinding>;
        }
      } catch {
        // Skip rows with corrupt JSON.
      }
    }
  } catch (error) {
    console.error("Keybindings migration: failed to read connection_settings:", error);
  }
  return null;
}

export async function getKeybindings(): Promise<{
  success: true;
  data: Record<string, Keybinding>;
  filePath: string;
}> {
  const filePath = getKeybindingsFilePath();
  const existing = readJsonFile(filePath);
  if (existing) {
    return { success: true, data: existing, filePath };
  }

  // First run against this file — migrate legacy per-connection SQLite data
  // if any exists, otherwise seed with the built-in defaults, so the file
  // is always present and immediately useful to open/edit.
  const migrated = await migrateFromSqlite();
  const seeded = withMissingDefaultKeybindings(migrated || getDefaultKeybindings());
  writeJsonFile(filePath, seeded);
  return { success: true, data: seeded, filePath };
}

export async function saveKeybindings(keybindings: Record<string, Keybinding>) {
  const filePath = getKeybindingsFilePath();
  try {
    writeJsonFile(filePath, keybindings || {});
    return { success: true, filePath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save keybindings.json",
    };
  }
}
