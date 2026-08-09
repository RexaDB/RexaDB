export interface IndexDef {
  name: string;
  columns: string[];
  isUnique: boolean;
}

export function mapPgIndexRow(row: any): IndexDef {
  const def = row.indexdef as string;
  const colsMatch = def.match(/\(([^)]+)\)/);
  const cols = colsMatch ? colsMatch[1].split(",").map((c: string) => c.trim().replace(/"/g, "")) : [];
  return {
    name: row.indexname,
    columns: cols,
    isUnique: def.toUpperCase().includes("UNIQUE"),
  };
}

export function mapSqliteIndexRow(idxRow: any, idxCols: string[]): IndexDef {
  return {
    name: String(idxRow.name || ""),
    columns: idxCols,
    isUnique: Number(idxRow.unique || 0) > 0,
  };
}
