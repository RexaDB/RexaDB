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

function sqlLiteral(value: unknown, dbType: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") {
    // SQL Server has no TRUE/FALSE literals — BIT expects 1/0.
    if (dbType === "mssql") return value ? "1" : "0";
    return value ? "TRUE" : "FALSE";
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/** Database types whose cell edits don't map to an SQL UPDATE preview. */
export function isNonSqlPreviewDbType(dbType: string): boolean {
  return dbType === "mongodb" || dbType === "redis";
}

/** Count rows that can't be saved because they lack a primary key (`idx:<n>` ids). */
export function countUnsaveablePendingRows(
  changes: PendingCellChanges | null | undefined,
): number {
  return Object.keys(changes ?? {}).filter((rowId) => rowId.startsWith("idx:")).length;
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
  // MongoDB/Redis edits commit through native drivers, so an SQL UPDATE
  // preview would misrepresent the operation being approved.
  if (isNonSqlPreviewDbType(dbType)) return [];
  const quote = (value: string) => quoteIdentifier(value, dbType);
  const tableRef = dbType === "spacetimedb" || !schemaName
    ? quote(tableName)
    : `${quote(schemaName)}.${quote(tableName)}`;

  return Object.entries(changes ?? {}).flatMap(([rowId, fields]) => {
    // Rows without a primary key get synthetic `idx:<n>` ids. The commit path
    // rejects these, so don't fabricate a WHERE "idx" = ... predicate.
    if (rowId.startsWith("idx:")) return [];
    const assignments = Object.entries(fields ?? {}).map(([column, edit]) => {
      const value = (edit as { new?: unknown })?.new;
      return `${quote(column)} = ${sqlLiteral(value, dbType)}`;
    });
    const conditions = rowId.split("|").map((part) => {
      const separator = part.indexOf(":");
      if (separator < 0) return "";
      const column = part.slice(0, separator);
      if (!column || column === "idx") return "";
      const value = part.slice(separator + 1);
      return `${quote(column)} = ${sqlLiteral(value, dbType)}`;
    }).filter(Boolean);
    if (assignments.length === 0 || conditions.length === 0) return [];
    return [`UPDATE ${tableRef} SET ${assignments.join(", ")} WHERE ${conditions.join(" AND ")};`];
  });
}
