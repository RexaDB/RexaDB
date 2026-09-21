// Pure data-dictionary helpers — no I/O, fully unit-tested.
// Key format mirrors the Rust backend: `schema.table`, `schema.table.column`.

import type {
  CatalogColumnEntry,
  CatalogTableEntry,
  ColumnDecorator,
  DictionaryScope,
  NativeCommentMaps,
} from "./types";

function escapeKeyPart(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.");
}

function unescapeKeyPart(raw: string): string {
  return String(raw || "").replace(/\\(\\|.)/g, (_, ch: string) => ch);
}

/** Split on unescaped dots; backslash escapes the next char. */
function splitEscaped(key: string): string[] {
  const parts: string[] = [];
  let current = "";
  const s = String(key || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      current += s[i + 1];
      i++;
    } else if (ch === ".") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export function tableKey(schema: string, table: string): string {
  return `${escapeKeyPart(schema)}.${escapeKeyPart(table)}`;
}

export function columnKey(schema: string, table: string, column: string): string {
  return `${escapeKeyPart(schema)}.${escapeKeyPart(table)}.${escapeKeyPart(column)}`;
}

export function splitTableKey(key: string): { schema: string; table: string } | null {
  const parts = splitEscaped(key);
  if (parts.length !== 2 || parts.some((p) => !p)) return null;
  return { schema: unescapeKeyPart(parts[0]), table: unescapeKeyPart(parts[1]) };
}

export function splitColumnKey(
  key: string,
): { schema: string; table: string; column: string } | null {
  const parts = splitEscaped(key);
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return {
    schema: unescapeKeyPart(parts[0]),
    table: unescapeKeyPart(parts[1]),
    column: unescapeKeyPart(parts[2]),
  };
}

// ---------------------------------------------------------------------------
// Decorators (data-decorator parity): raw value -> display string
// ---------------------------------------------------------------------------

export interface DecoratedDisplay {
  display: string;
  /** true when the raw value is hidden (masking) — callers must not copy it */
  masked: boolean;
}

function stringifyRaw(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function applyColumnDecorator(
  value: unknown,
  decorator: ColumnDecorator | null | undefined,
): DecoratedDisplay {
  const fallback = stringifyRaw(value);
  if (value === null || value === undefined) return { display: "NULL", masked: false };
  if (!decorator) return { display: fallback, masked: false };

  switch (decorator.kind) {
    case "enum-map": {
      const label = decorator.mapping[stringifyRaw(value)];
      return { display: label ?? fallback, masked: false };
    }
    case "mask": {
      const maskChar = decorator.maskChar || "•";
      const visible = Math.max(0, Math.min(decorator.visibleChars ?? 0, fallback.length));
      const hidden = fallback.length - visible;
      if (hidden <= 0) return { display: fallback, masked: false };
      return {
        display: maskChar.repeat(Math.min(hidden, 64)) + fallback.slice(fallback.length - visible),
        masked: true,
      };
    }
    case "prefix-suffix": {
      return {
        display: `${decorator.prefix ?? ""}${fallback}${decorator.suffix ?? ""}`,
        masked: false,
      };
    }
    case "truncate": {
      const max = Math.max(1, Math.min(decorator.maxLength || 0, 10_000)) || 120;
      if (fallback.length <= max) return { display: fallback, masked: false };
      return { display: `${fallback.slice(0, max)}…`, masked: false };
    }
    case "date-format": {
      const date = value instanceof Date ? value : new Date(stringifyRaw(value));
      if (Number.isNaN(date.getTime())) return { display: fallback, masked: false };
      if (decorator.format === "relative") return { display: relativeTime(date), masked: false };
      try {
        if (decorator.format === "date") return { display: date.toLocaleDateString(), masked: false };
        if (decorator.format === "time") return { display: date.toLocaleTimeString(), masked: false };
        return { display: date.toLocaleString(), masked: false };
      } catch {
        return { display: fallback, masked: false };
      }
    }
    default:
      return { display: fallback, masked: false };
  }
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) {
    const n = Math.floor(abs / minute);
    return `${n} min${n === 1 ? "" : "s"}${diffMs >= 0 ? " ago" : " from now"}`;
  }
  if (abs < day) {
    const n = Math.floor(abs / hour);
    return `${n} hour${n === 1 ? "" : "s"}${diffMs >= 0 ? " ago" : " from now"}`;
  }
  const n = Math.floor(abs / day);
  return `${n} day${n === 1 ? "" : "s"}${diffMs >= 0 ? " ago" : " from now"}`;
}

export function isValidDecorator(value: unknown): value is ColumnDecorator {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  switch (obj.kind) {
    case "enum-map":
      return !!obj.mapping && typeof obj.mapping === "object";
    case "mask":
    case "prefix-suffix":
    case "date-format":
      return true;
    case "truncate": {
      const max = Number(obj.maxLength);
      return Number.isInteger(max) && max >= 1 && max <= 10_000;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Local overlay + native comment merge (local wins when present)
// ---------------------------------------------------------------------------

export function mergeDescription(
  local: string | null | undefined,
  native: string | null | undefined,
): { description: string | null; source: "local" | "native" | null } {
  const localTrimmed = String(local || "").trim();
  if (localTrimmed) return { description: localTrimmed, source: "local" };
  const nativeTrimmed = String(native || "").trim();
  if (nativeTrimmed) return { description: nativeTrimmed, source: "native" };
  return { description: null, source: null };
}

// ---------------------------------------------------------------------------
// Catalog assembly + search (data-catalog parity)
// ---------------------------------------------------------------------------

export interface CatalogSourceTable {
  schema: string;
  table: string;
  columns: Array<{
    column: string;
    dataType: string;
    isNullable: boolean;
    isPrimary: boolean;
    isForeignKey: boolean;
  }>;
}

export function buildCatalogEntries(
  sources: CatalogSourceTable[],
  dictionary: DictionaryScope,
  native: NativeCommentMaps = { tables: {}, columns: {} },
): CatalogTableEntry[] {
  return sources.map((source) => {
    const tKey = tableKey(source.schema, source.table);
    const tableMerged = mergeDescription(dictionary.tables[tKey], native.tables[tKey]);
    return {
      schema: source.schema,
      table: source.table,
      description: tableMerged.description,
      descriptionSource: tableMerged.source,
      columns: source.columns.map((col) => {
        const cKey = columnKey(source.schema, source.table, col.column);
        const merged = mergeDescription(dictionary.columns[cKey], native.columns[cKey]);
        const decorator = dictionary.decorators[cKey];
        return {
          schema: source.schema,
          table: source.table,
          column: col.column,
          dataType: col.dataType,
          isNullable: col.isNullable,
          isPrimary: col.isPrimary,
          isForeignKey: col.isForeignKey,
          description: merged.description,
          descriptionSource: merged.source,
          decorator: isValidDecorator(decorator) ? decorator : null,
        } satisfies CatalogColumnEntry;
      }),
    };
  });
}

export interface CatalogSearchHit {
  kind: "table" | "column";
  schema: string;
  table: string;
  column: string | null;
  description: string | null;
  score: number;
}

export function searchCatalog(entries: CatalogTableEntry[], query: string): CatalogSearchHit[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    return entries.map((entry) => ({
      kind: "table" as const,
      schema: entry.schema,
      table: entry.table,
      column: null,
      description: entry.description,
      score: 0,
    }));
  }
  const hits: CatalogSearchHit[] = [];
  for (const entry of entries) {
    const tableName = entry.table.toLowerCase();
    const tableDesc = String(entry.description || "").toLowerCase();
    if (tableName === q) {
      hits.push({ kind: "table", schema: entry.schema, table: entry.table, column: null, description: entry.description, score: 100 });
    } else if (tableName.startsWith(q)) {
      hits.push({ kind: "table", schema: entry.schema, table: entry.table, column: null, description: entry.description, score: 70 });
    } else if (tableName.includes(q)) {
      hits.push({ kind: "table", schema: entry.schema, table: entry.table, column: null, description: entry.description, score: 50 });
    } else if (tableDesc.includes(q)) {
      hits.push({ kind: "table", schema: entry.schema, table: entry.table, column: null, description: entry.description, score: 30 });
    }
    for (const col of entry.columns) {
      const colName = col.column.toLowerCase();
      const colDesc = String(col.description || "").toLowerCase();
      if (colName === q) {
        hits.push({ kind: "column", schema: entry.schema, table: entry.table, column: col.column, description: col.description, score: 90 });
      } else if (colName.startsWith(q)) {
        hits.push({ kind: "column", schema: entry.schema, table: entry.table, column: col.column, description: col.description, score: 60 });
      } else if (colName.includes(q)) {
        hits.push({ kind: "column", schema: entry.schema, table: entry.table, column: col.column, description: col.description, score: 40 });
      } else if (colDesc.includes(q)) {
        hits.push({ kind: "column", schema: entry.schema, table: entry.table, column: col.column, description: col.description, score: 25 });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
