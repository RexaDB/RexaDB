import { formatDistanceToNow, isValid, parseISO } from "date-fns";

/** Ports `safeParseDate` from the legacy grid (grid/grid-cell.tsx) verbatim. */
export function safeParseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isValid(val) ? val : null;
  if (typeof val === "string") {
    const parsed = parseISO(val);
    return isValid(parsed) ? parsed : null;
  }
  if (typeof val === "number") {
    const parsed = new Date(val);
    return isValid(parsed) ? parsed : null;
  }
  return null;
}

export function computeRelativeDateLabel(value: any): string | null {
  const date = safeParseDate(value);
  if (!date) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

export type RexaCellKind =
  | "null"
  | "boolean"
  | "enum"
  | "json"
  | "date"
  | "number"
  | "text";

export interface RexaCellData {
  value: any;
  displayValue: string;
  kind: RexaCellKind;
  columnName: string;
  rowIndex: number;
  rowId: string | null;
  isRtl: boolean;
  isSelected: boolean;
  isPendingChange: boolean;
  isPendingDelete: boolean;
  isSearchMatch: boolean;
  isColumnHovered: boolean;
  isRowHovered: boolean;
  isCellHovered: boolean;
  cellHoverColor: string;
  rowHoverColor: string;
  columnHoverColor: string;
  dataBarRatio: number | null;
  colorizedPills: boolean;
  relativeDates: boolean;
  richJsonInspector: boolean;
  jsonType: "Array" | "Object" | null;
  enumOptions: string[] | undefined;
  columnType: string;
  readonlyCell: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isFKButtonHovered: boolean;
  relativeDateLabel: string | null;
  originalValue: any;
  discardChange: (() => void) | null;
  rowSpacing: "compact" | "standard" | "relaxed";
}

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

export function detectArabicScript(text: string): boolean {
  return ARABIC_SCRIPT_RE.test(text);
}

export function classifyColumnType(columnType: string | undefined | null) {
  const t = String(columnType || "").toLowerCase();
  return {
    isDate: t.includes("timestamp") || t.includes("date"),
    isBoolean: t === "boolean" || t === "bool" || t.includes("bool"),
    isNumeric:
      t.includes("int") ||
      t.includes("float") ||
      t.includes("decimal") ||
      t.includes("numeric"),
  };
}

export function detectJsonInfo(
  value: any,
  richJsonInspector: boolean,
): { type: "Array" | "Object"; data: any } | null {
  if (!richJsonInspector || value === null || value === undefined) return null;

  if (typeof value === "object") {
    return { data: value, type: Array.isArray(value) ? "Array" : "Object" };
  }

  if (typeof value === "string" && value.length > 1) {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return { data: parsed, type: Array.isArray(parsed) ? "Array" : "Object" };
        }
      } catch {
        // not valid JSON — fall through to plain text
      }
    }
  }
  return null;
}

export function buildEnumByName(
  enums: Array<{ schema: string; name: string; values: string[] }> | undefined,
): Map<string, { schema: string; name: string; values: string[] }[]> {
  const map = new Map<string, { schema: string; name: string; values: string[] }[]>();
  for (const e of enums ?? []) {
    const list = map.get(e.name) ?? [];
    list.push(e);
    map.set(e.name, list);
  }
  return map;
}

export function resolveEnumOptions(
  struct: any,
  enumByName: Map<string, { schema: string; name: string; values: string[] }[]>,
): string[] | undefined {
  const udtName = String(struct?.udt_name || "").trim();
  if (!udtName) return undefined;
  const udtSchema = String(struct?.udt_schema || "").trim();
  const match =
    enumByName.get(udtName)?.find((e) => !udtSchema || e.schema === udtSchema) ||
    enumByName.get(udtName)?.[0];
  return Array.isArray(match?.values) ? match.values : undefined;
}

/** Ports `getSortLabels` from the legacy grid (grid/grid-header.tsx) verbatim. */
export function getSortLabels(dataType: string): { asc: string; desc: string } {
  const t = dataType.toLowerCase();
  if (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("real") ||
    t.includes("double") ||
    t.includes("serial")
  ) {
    return { asc: "Less to more", desc: "More to less" };
  }
  if (t.includes("date") || t.includes("time") || t.includes("timestamp")) {
    return { asc: "Oldest first", desc: "Newest first" };
  }
  if (t.includes("bool")) {
    return { asc: "False first", desc: "True first" };
  }
  return { asc: "A - Z", desc: "Z - A" };
}

function isActionForThisTable(
  action: { metadata?: any },
  selectedSchema: string | null | undefined,
  selectedTable: string | null | undefined,
): boolean {
  const schemaName = selectedSchema ?? "";
  const tableName = selectedTable ?? "";
  const isMongo = action.metadata?.database && action.metadata?.collection;
  return isMongo
    ? action.metadata.database === schemaName && action.metadata.collection === tableName
    : action.metadata?.schema === schemaName && action.metadata?.table === tableName;
}

/**
 * Ports `pendingDeleteState` from the legacy grid (data-grid.tsx) verbatim:
 * scans the pending-action queue for `delete_column`/`delete_row` entries
 * scoped to the current table.
 */
export function computePendingDeleteState(
  pendingActions: Array<{ type: string; metadata: any }>,
  selectedSchema: string | null | undefined,
  selectedTable: string | null | undefined,
) {
  const deletedColumns = new Set<string>();
  const deletedRowIds = new Set<string>();
  const deletedRowWhereClauses: Array<Record<string, any>> = [];

  for (const action of pendingActions) {
    if (action?.type === "delete_column") {
      if (!isActionForThisTable(action, selectedSchema, selectedTable)) continue;
      const columnName = action.metadata?.columnName;
      if (typeof columnName === "string" && columnName.trim()) {
        deletedColumns.add(columnName);
      }
    }

    if (action?.type === "delete_row") {
      if (!isActionForThisTable(action, selectedSchema, selectedTable)) continue;
      const where = action.metadata?.where;
      if (!where || typeof where !== "object") continue;
      deletedRowWhereClauses.push(where);
      const rowId = Object.entries(where)
        .map(([col, val]) => `${col}:${val}`)
        .join("|");
      if (rowId) deletedRowIds.add(rowId);
    }
  }

  return { deletedColumns, deletedRowIds, deletedRowWhereClauses };
}

/** Ports `isRowPendingDelete` from the legacy grid verbatim. */
export function isRowPendingDelete(
  row: any,
  rowId: string | null,
  pendingDeleteState: ReturnType<typeof computePendingDeleteState>,
): boolean {
  if (rowId && pendingDeleteState.deletedRowIds.has(rowId)) return true;
  return pendingDeleteState.deletedRowWhereClauses.some((whereClause) =>
    Object.entries(whereClause).every(
      ([column, expected]) => String(row?.[column]) === String(expected),
    ),
  );
}

/**
 * Ports the numeric column-max computation from the legacy grid
 * (data-grid.tsx's `columnMaxValues`) verbatim — used to size the
 * background data-bar fill proportionally per column.
 */
export function computeColumnMaxValues(
  results: { rows?: any[]; fields?: Array<{ name: string }> } | null | undefined,
  tableStructure: any[] | undefined,
  dataBarsEnabled: boolean,
): Record<string, number> {
  if (!dataBarsEnabled || !results?.rows || !results?.fields) return {};
  const maxValues: Record<string, number> = {};
  results.fields.forEach((field) => {
    const struct = tableStructure?.find(
      (c) => (c.name || c.column_name) === field.name,
    );
    const { isNumeric } = classifyColumnType(struct?.data_type);
    if (!isNumeric) return;
    let max = 0;
    results.rows!.forEach((row: any) => {
      const val = Number(row[field.name]);
      if (!isNaN(val) && val > max) max = val;
    });
    maxValues[field.name] = max;
  });
  return maxValues;
}
