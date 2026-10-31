import type { SchemaPlan, SchemaPlanColumnChange } from "@/lib/ai/types";

export function extractCodeBlock(source: string, language: string) {
  const pattern = new RegExp(`\\\`\\\`\\\`${language}\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\``, "i");
  const match = String(source || "").match(pattern);
  return match?.[1]?.trim() || null;
}

const COLUMN_CHANGES = new Set<SchemaPlanColumnChange>([
  "added",
  "removed",
  "unchanged",
  "modified",
]);

function normalizeColumnChange(value: unknown): SchemaPlanColumnChange | null {
  if (typeof value !== "string") return null;
  const change = value.trim().toLowerCase() as SchemaPlanColumnChange;
  return COLUMN_CHANGES.has(change) ? change : null;
}

/** Accept both array-of-column objects and { colName: "added" } maps. */
function normalizeColumns(raw: unknown): SchemaPlan["tables"][number]["columns"] {
  if (Array.isArray(raw)) {
    return raw
      .map((col: any) => {
        if (!col || typeof col !== "object") return null;
        const name = String(col.name || "").trim();
        const change = normalizeColumnChange(col.change);
        if (!name || !change) return null;
        return {
          name,
          type: String(col.type || "").trim() || "—",
          change,
          previousType:
            typeof col.previousType === "string" ? col.previousType : undefined,
          nullable: typeof col.nullable === "boolean" ? col.nullable : undefined,
          note: typeof col.note === "string" ? col.note : undefined,
        };
      })
      .filter(Boolean) as SchemaPlan["tables"][number]["columns"];
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([name, value]) => {
        // Support "*": "unchanged" as a note-only row
        if (name === "*") {
          const change = normalizeColumnChange(value) || "unchanged";
          return {
            name: "(all columns)",
            type: "—",
            change,
            note:
              typeof value === "string" && !COLUMN_CHANGES.has(value as any)
                ? value
                : undefined,
          };
        }
        if (typeof value === "string") {
          const change = normalizeColumnChange(value);
          if (!change) return null;
          return { name, type: "—", change };
        }
        if (value && typeof value === "object") {
          const obj = value as Record<string, unknown>;
          const change = normalizeColumnChange(obj.change ?? obj.status);
          if (!change) return null;
          return {
            name,
            type: String(obj.type || "").trim() || "—",
            change,
            previousType:
              typeof obj.previousType === "string" ? obj.previousType : undefined,
            note: typeof obj.note === "string" ? obj.note : undefined,
          };
        }
        return null;
      })
      .filter(Boolean) as SchemaPlan["tables"][number]["columns"];
  }

  return [];
}

function inferAction(
  explicit: unknown,
  columns: SchemaPlan["tables"][number]["columns"],
): "create" | "alter" | "drop" {
  if (explicit === "create" || explicit === "alter" || explicit === "drop") {
    return explicit;
  }
  if (columns.length > 0 && columns.every((c) => c.change === "added")) return "create";
  if (columns.length > 0 && columns.every((c) => c.change === "removed")) return "drop";
  return "alter";
}

function normalizeApplySql(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const parts = raw.filter((s) => typeof s === "string" && s.trim());
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

/** True when a parsed JSON object looks like a schema-plan payload. */
export function looksLikeSchemaPlan(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const tables = (value as any).tables;
  if (!Array.isArray(tables) || tables.length === 0) return false;
  return tables.some(
    (t) =>
      t &&
      typeof t === "object" &&
      (typeof t.table === "string" || typeof t.name === "string") &&
      t.columns != null,
  );
}

/** Parse a raw JSON string (no fences) into a SchemaPlan. */
export function parseSchemaPlanJson(raw: string): SchemaPlan | null {
  try {
    const parsed = JSON.parse(raw);
    if (!looksLikeSchemaPlan(parsed)) return null;

    const tableNotes: string[] = [];
    const tables = (parsed.tables as any[])
      .map((table) => {
        if (!table || typeof table !== "object") return null;
        const tableName = String(table.table || table.name || "").trim();
        if (!tableName) return null;
        const columns = normalizeColumns(table.columns);
        if (typeof table.note === "string" && table.note.trim()) {
          tableNotes.push(`${tableName}: ${table.note.trim()}`);
        }
        return {
          schema: String(table.schema || "public").trim() || "public",
          table: tableName,
          action: inferAction(table.action, columns),
          columns,
        };
      })
      .filter(Boolean) as SchemaPlan["tables"];

    if (tables.length === 0) return null;

    const notes = [
      ...(Array.isArray(parsed.notes)
        ? parsed.notes.filter((n: unknown) => typeof n === "string")
        : []),
      ...tableNotes,
    ];

    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      mode: parsed.mode === "build" || parsed.mode === "plan" ? parsed.mode : "plan",
      tables,
      notes: notes.length > 0 ? notes : undefined,
      applySql: normalizeApplySql(parsed.applySql),
    };
  } catch {
    return null;
  }
}

export function parseSchemaPlanBlock(source: string): SchemaPlan | null {
  const block =
    extractCodeBlock(source, "schema-plan") ||
    extractCodeBlock(source, "schemaplan") ||
    // Agents often fence as ```json — accept when payload looks like a plan.
    (() => {
      const jsonBlock = extractCodeBlock(source, "json");
      if (!jsonBlock) return null;
      try {
        const parsed = JSON.parse(jsonBlock);
        return looksLikeSchemaPlan(parsed) ? jsonBlock : null;
      } catch {
        return null;
      }
    })();

  if (!block) return null;
  return parseSchemaPlanJson(block);
}
