export interface ColumnDef {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
}

export interface IndexDef {
  name: string;
  columns: string[];
  isUnique: boolean;
}

export interface ForeignKeyDef {
  name: string;
  columns: string[];
  foreignSchema: string;
  foreignTable: string;
  foreignColumns: string[];
}

export interface TableDef {
  schema: string;
  name: string;
  columns: ColumnDef[];
  primaryKey: string[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
}

export interface ViewDef {
  schema: string;
  name: string;
  definition: string;
}

export interface EnumDef {
  schema: string;
  name: string;
  values: string[];
}

export interface SchemaDef {
  tables: TableDef[];
  views: ViewDef[];
  enums: EnumDef[];
}

export interface SnapshotMeta {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  engine: string;
  connectionString: string;
  tableCount: number;
  rowCount: number;
  schemaHash: string;
}

export interface DatabaseSnapshot {
  meta: SnapshotMeta;
  schemaSQL: string;
  dataSQL: string;
  schemaStructured: SchemaDef;
  dataTables: Record<string, Record<string, unknown>[]>;
}

export interface SchemaChange {
  type: "table" | "column" | "view" | "enum";
  action: "added" | "removed" | "modified";
  entityName: string;
  details?: string;
}

export interface RowDiff {
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  modified: { old: Record<string, unknown>; new: Record<string, unknown> }[];
}

export interface DataChange {
  table: string;
  rowCount: number;
  rowsAdded: number;
  rowsRemoved: number;
  rowsModified: number;
  sampleAdded: Record<string, unknown>[];
  sampleRemoved: Record<string, unknown>[];
  sampleModified: { old: Record<string, unknown>; new: Record<string, unknown> }[];
  allAdded: Record<string, unknown>[];
  allRemoved: Record<string, unknown>[];
  allModified: { old: Record<string, unknown>; new: Record<string, unknown> }[];
}

export interface SnapshotDiff {
  id: string;
  olderId: string;
  newerId: string;
  olderName: string;
  newerName: string;
  schemaChanges: SchemaChange[];
  dataChanges: DataChange[];
  summary: {
    tablesAdded: number;
    tablesRemoved: number;
    tablesModified: number;
    rowsAdded: number;
    rowsRemoved: number;
    rowsModified: number;
  };
}

export type SnapshotProgressEvent =
  | { type: "table-start"; table: string; current: number; total: number }
  | { type: "table-progress"; table: string; current: number; total: number; rows: number }
  | { type: "table-chunk"; table: string; current: number; total: number; rows: number; chunk: number }
  | { type: "table-done"; table: string; current: number; total: number; rows: number; truncated: boolean }
  | { type: "table-error"; table: string; current: number; total: number; error: string };

// fallow-ignore-next-line code-duplication
export function hashSchema(schema: SchemaDef): string {
  const str = JSON.stringify(schema);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function sanitizeSnapshotName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "snapshot";
}

export function generateSnapshotId(): string {
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") + "T" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  return ts;
}

export function escapeSqlString(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return String(val);
  const str = String(val);
  return "'" + str.replace(/'/g, "''").replace(/\\/g, "\\\\") + "'";
}

export function quoteIdent(engine: string, name: string): string {
  if (engine === "mysql") return "`" + name.replace(/`/g, "``") + "`";
  return '"' + name.replace(/"/g, '""') + '"';
}

export interface SnapshotTableTabData {
  snapshotName: string;
  tableRef: string;
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
}

export const snapshotTableDataStore = new Map<string, SnapshotTableTabData>();

export interface DiffTableTabData {
  olderName: string;
  newerName: string;
  dataChange: DataChange;
}

export const diffTableDataStore = new Map<string, DiffTableTabData>();
