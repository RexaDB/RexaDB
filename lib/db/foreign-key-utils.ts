/**
 * Studio FK consumers expect foreign_table_schema / foreign_table_name /
 * foreign_column_name. Some backends (notably older SMGT responses) use
 * referenced_* names instead — normalize once at the boundary.
 */
export type StudioForeignKey = {
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() && value !== "undefined") {
      return value.trim();
    }
  }
  return null;
}

export function normalizeStudioForeignKey(
  raw: Record<string, unknown> | null | undefined,
): StudioForeignKey | null {
  if (!raw || typeof raw !== "object") return null;

  const column_name = pickString(
    raw.column_name,
    raw.columnName,
    raw.source_column,
    raw.source_column_name,
  );
  const foreign_table_schema = pickString(
    raw.foreign_table_schema,
    raw.referenced_schema,
    raw.referenced_table_schema,
    raw.foreignSchema,
    raw.schema,
  );
  const foreign_table_name = pickString(
    raw.foreign_table_name,
    raw.referenced_table,
    raw.referenced_table_name,
    raw.foreignTable,
    raw.table,
  );
  const foreign_column_name = pickString(
    raw.foreign_column_name,
    raw.referenced_column,
    raw.referenced_column_name,
    raw.foreignColumn,
    raw.column,
  );

  if (!column_name || !foreign_table_name || !foreign_column_name) {
    return null;
  }

  return {
    column_name,
    foreign_table_schema: foreign_table_schema || "public",
    foreign_table_name,
    foreign_column_name,
  };
}

export function normalizeStudioForeignKeys(
  rows: unknown,
): StudioForeignKey[] {
  if (!Array.isArray(rows)) return [];
  const out: StudioForeignKey[] = [];
  for (const row of rows) {
    const normalized = normalizeStudioForeignKey(
      row && typeof row === "object" ? (row as Record<string, unknown>) : null,
    );
    if (normalized) out.push(normalized);
  }
  return out;
}

export function findStudioForeignKey(
  rows: unknown,
  columnName: string,
): StudioForeignKey | null {
  if (!columnName) return null;
  return (
    normalizeStudioForeignKeys(rows).find((fk) => fk.column_name === columnName) ??
    null
  );
}
