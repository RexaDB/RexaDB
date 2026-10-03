export type PendingCellChanges = Record<string, Record<string, unknown>>;

export function countPendingCellEdits(changes: PendingCellChanges | null | undefined): number {
  return Object.values(changes ?? {}).reduce((total, row) => {
    return total + (row && typeof row === "object" ? Object.keys(row).length : 0);
  }, 0);
}

function quoteIdentifier(value: string | null | undefined, dbType: string): string {
  const identifier = String(value ?? "");
  if (dbType === "mysql" || dbType === "clickhouse") return `\`${identifier.replace(/`/g, "``")}\``;
  if (dbType === "mssql") return "[" + identifier.replace(/]/g, "]]" ) + "]";
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

export function buildPendingEditsSql(
  changes: PendingCellChanges,
  schema: string | null | undefined,
  table: string | null | undefined,
  dbType: string,
): string[] {
  const tableName = String(table ?? "").trim();
  const schemaName = String(schema ?? "").trim();
  if (!tableName) return [];
  const quote = (value: string) => quoteIdentifier(value, dbType);
  const tableRef = dbType === "spacetimedb" || !schemaName
    ? quote(tableName)
    : `${quote(schemaName)}.${quote(tableName)}`;

  return Object.entries(changes).flatMap(([rowId, fields]) => {
    const assignments = Object.entries(fields ?? {}).map(([column, edit]) => {
      const value = (edit as { new?: unknown })?.new;
      return `${quote(column)} = ${sqlLiteral(value)}`;
    });
    const conditions = rowId.split("|").map((part) => {
      const separator = part.indexOf(":");
      if (separator < 0) return "";
      const column = part.slice(0, separator);
      const value = part.slice(separator + 1);
      return `${quote(column)} = ${sqlLiteral(value)}`;
    }).filter(Boolean);
    if (assignments.length === 0 || conditions.length === 0) return [];
    return [`UPDATE ${tableRef} SET ${assignments.join(", ")} WHERE ${conditions.join(" AND ")};`];
  });
}
