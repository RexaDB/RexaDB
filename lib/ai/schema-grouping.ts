import type { LightSchemaContextTable } from "@/lib/ai/types";

/**
 * Groups flat schema rows (`table_schema`/`table_name`/`column_name`) into
 * `LightSchemaContextTable[]`. Shared by client hooks, AgentsClient, and the
 * sidecar server to avoid triplicate grouping loops.
 */
export function groupSchemaRows(rows: Array<Record<string, unknown>>): LightSchemaContextTable[] {
  const grouped = new Map<string, LightSchemaContextTable>();

  for (const row of rows) {
    const schema = String((row as any)?.table_schema || (row as any)?.schema || "").trim();
    const table = String((row as any)?.table_name || (row as any)?.name || "").trim();
    if (!schema || !table) continue;

    const key = `${schema}.${table}`;
    const existing = grouped.get(key) || { schema, table, columns: [] };
    const columnName = String((row as any)?.column_name || "").trim();
    if (columnName) {
      existing.columns.push({
        name: columnName,
        type: String((row as any)?.data_type || "text"),
      });
    }
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) =>
    `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`),
  );
}
