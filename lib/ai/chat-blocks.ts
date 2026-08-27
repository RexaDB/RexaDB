import type { AgentWorkflowPlan, SchemaPlan, SchemaPlanColumnChange } from "@/lib/ai/types";

export function extractCodeBlock(source: string, language: string) {
  const pattern = new RegExp(`\\\`\\\`\\\`${language}\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\``, "i");
  const match = String(source || "").match(pattern);
  return match?.[1]?.trim() || null;
}

export function parseDashboardBlock(source: string) {
  const block = extractCodeBlock(source, "dashboard");
  if (!block) return null;
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

export type ParsedThemeBlock =
  | { type: "app"; autoApply?: boolean; theme: { id: string; name: string; base: "light" | "dark"; colors?: Record<string, string> } }
  | { type: "editor"; autoApply?: boolean; theme: { id: string; name: string; themeJson?: string } };

export function parseThemeBlock(source: string): ParsedThemeBlock | null {
  const block = extractCodeBlock(source, "theme");
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type !== "app" && parsed.type !== "editor") return null;
    if (!parsed.theme || typeof parsed.theme !== "object") return null;
    if (typeof parsed.theme.id !== "string" || !parsed.theme.id.trim()) return null;
    if (typeof parsed.theme.name !== "string" || !parsed.theme.name.trim()) return null;
    if (parsed.type === "app") {
      if (parsed.theme.base !== "light" && parsed.theme.base !== "dark") return null;
    }
    return parsed as ParsedThemeBlock;
  } catch {
    return null;
  }
}

export function parseWorkflowBlock(source: string): AgentWorkflowPlan | null {
  const block = extractCodeBlock(source, "workflow");
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    if (!parsed.nodes.every((node: any) => node && typeof node === "object" && typeof node.type === "string")) return null;
    return parsed as AgentWorkflowPlan;
  } catch {
    return null;
  }
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
