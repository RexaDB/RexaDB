// Dictionary storage bridge. Desktop (Tauri) talks to the Rust backend
// (src-tauri/src/dictionary.rs); anywhere else (web) falls back to a
// localStorage mirror with the identical shape. The sidecar is deliberately
// not involved — no new HTTP endpoints.
"use client";

import { isDesktopRuntime } from "@/lib/desktop";
import type { ColumnDecorator, DictionaryScope } from "./types";
import { freshEmptyScope } from "./types";
import { isValidDecorator } from "./helpers";

const STORAGE_PREFIX = "rexadb.dictionary.";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function localKey(connectionId: number): string {
  return `${STORAGE_PREFIX}${connectionId}`;
}

function readLocal(connectionId: number): DictionaryScope {
  try {
    const raw = localStorage.getItem(localKey(connectionId));
    if (!raw) return freshEmptyScope();
    const parsed = JSON.parse(raw) as Partial<DictionaryScope>;
    const decorators: DictionaryScope["decorators"] = {};
    for (const [key, value] of Object.entries(parsed.decorators || {})) {
      if (isValidDecorator(value)) decorators[key] = value;
    }
    return {
      tables: { ...(parsed.tables || {}) },
      columns: { ...(parsed.columns || {}) },
      decorators,
      updatedAt: { ...(parsed.updatedAt || {}) },
    };
  } catch {
    return freshEmptyScope();
  }
}

function writeLocal(connectionId: number, scope: DictionaryScope) {
  try {
    localStorage.setItem(localKey(connectionId), JSON.stringify(scope));
  } catch {
    // Storage full / private mode — dictionary simply doesn't persist.
  }
}

export async function getDictionaryScope(connectionId: number): Promise<DictionaryScope> {
  if (!connectionId || connectionId <= 0 || typeof window === "undefined") {
    return freshEmptyScope();
  }
  if (isDesktopRuntime()) {
    try {
      const scope = await tauriInvoke<DictionaryScope & { updated_at?: Record<string, number> }>(
        "dictionary_get",
        {
          connectionId,
        },
      );
      return {
        tables: scope.tables || {},
        columns: scope.columns || {},
        decorators: scope.decorators || {},
        // Rust serializes snake_case; accept both spellings.
        updatedAt: scope.updatedAt || scope.updated_at || {},
      };
    } catch {
      // Fall through to local mirror rather than breaking the view.
    }
  }
  return readLocal(connectionId);
}

function assertWritableId(connectionId: number) {
  if (!connectionId || connectionId <= 0) {
    throw new Error("No connection selected — descriptions can't be saved yet.");
  }
}

export async function setTableDescription(
  connectionId: number,
  schema: string,
  table: string,
  description: string,
): Promise<void> {
  assertWritableId(connectionId);
  if (isDesktopRuntime()) {
    try {
      await tauriInvoke("dictionary_set_table", {
        connectionId,
        schema,
        table,
        description,
      });
      return;
    } catch {
      // Fall through to local mirror.
    }
  }
  if (typeof window === "undefined") return;
  const scope = readLocal(connectionId);
  const key = `${schema.trim()}.${table.trim()}`;
  if (description.trim()) {
    scope.tables[key] = description.trim();
    scope.updatedAt[key] = Date.now();
  } else {
    delete scope.tables[key];
    delete scope.updatedAt[key];
  }
  writeLocal(connectionId, scope);
}

export async function setColumnDescription(
  connectionId: number,
  schema: string,
  table: string,
  column: string,
  description: string,
): Promise<void> {
  assertWritableId(connectionId);
  if (isDesktopRuntime()) {
    try {
      await tauriInvoke("dictionary_set_column", {
        connectionId,
        schema,
        table,
        column,
        description,
      });
      return;
    } catch {
      // Fall through to local mirror.
    }
  }
  if (typeof window === "undefined") return;
  const scope = readLocal(connectionId);
  const key = `${schema.trim()}.${table.trim()}.${column.trim()}`;
  if (description.trim()) {
    scope.columns[key] = description.trim();
    scope.updatedAt[key] = Date.now();
  } else {
    delete scope.columns[key];
    delete scope.updatedAt[key];
  }
  writeLocal(connectionId, scope);
}

export async function setColumnDecorator(
  connectionId: number,
  schema: string,
  table: string,
  column: string,
  decorator: ColumnDecorator | null,
): Promise<void> {
  if (decorator !== null && !isValidDecorator(decorator)) {
    throw new Error("Invalid decorator payload.");
  }
  assertWritableId(connectionId);
  if (isDesktopRuntime()) {
    try {
      await tauriInvoke("dictionary_set_decorator", {
        connectionId,
        schema,
        table,
        column,
        decorator,
      });
      return;
    } catch {
      // Fall through to local mirror.
    }
  }
  if (typeof window === "undefined") return;
  const scope = readLocal(connectionId);
  const key = `${schema.trim()}.${table.trim()}.${column.trim()}`;
  if (decorator) {
    scope.decorators[key] = decorator;
  } else {
    delete scope.decorators[key];
  }
  writeLocal(connectionId, scope);
}

export async function deleteDictionaryScope(connectionId: number): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      await tauriInvoke("dictionary_delete_scope", { connectionId });
    } catch {
      // Best effort.
    }
  }
  try {
    localStorage.removeItem(localKey(connectionId));
  } catch {
    // Ignore.
  }
}
