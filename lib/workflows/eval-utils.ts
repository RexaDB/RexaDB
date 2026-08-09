import type { WorkflowRunContext } from "./types";

// ─── Evaluation helpers ───────────────────────────────────────────────

export function toArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (val !== null && val !== undefined) return [val];
  return [];
}

export function evalExpression(expr: string, input: unknown, ctx: WorkflowRunContext): unknown {
  try {
    const fn = new Function("$input", "$vars", "$nodes", `return (${expr})`);
    return fn(input, ctx.vars, ctx.nodeOutputs);
  } catch (err: any) {
    throw new Error(`Expression error: ${err.message}`);
  }
}

// ─── Aggregate operations ─────────────────────────────────────────────

export function computeAggregate(
  arr: unknown[],
  field: string,
  operation: string,
): { operation: string; field: string; value: number } {
  const nums = arr
    .map((i: any) => Number(i?.[field] ?? i))
    .filter((n) => !isNaN(n));
  switch (operation) {
    case "count":
      return { operation: "count", field, value: arr.length };
    case "sum":
      return { operation: "sum", field, value: nums.reduce((a, b) => a + b, 0) };
    case "avg":
      return {
        operation: "avg",
        field,
        value: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0,
      };
    case "min":
      return { operation: "min", field, value: Math.min(...nums) };
    case "max":
      return { operation: "max", field, value: Math.max(...nums) };
    default:
      return { operation: "count", field, value: arr.length };
  }
}

// ─── DB insert rows ──────────────────────────────────────────────────

export async function insertRowsToTable(
  table: string,
  rowsExpr: unknown,
  input: unknown,
  ctx: WorkflowRunContext,
  runQuery: (connStr: string, sql: string, params: any[], options: any) => Promise<any>,
  connectionString: string,
  logs: string[],
): Promise<{ insertedCount: number; table: string }> {
  let rows: Record<string, unknown>[] = [];
  if (rowsExpr === "$input" || !rowsExpr) {
    rows = Array.isArray(input) ? (input as Record<string, unknown>[]) : [input as Record<string, unknown>];
  } else if (typeof rowsExpr === "string") {
    rows = evalExpression(rowsExpr, input, ctx) as Record<string, unknown>[];
  }
  if (!rows.length) {
    logs.push("No rows to insert");
    return { insertedCount: 0, table };
  }
  const keys = Object.keys(rows[0]);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  let insertedCount = 0;
  for (const row of rows) {
    const vals = keys.map((_, i) => `$${i + 1}`).join(", ");
    const params = keys.map((k) => row[k]);
    const result = await runQuery(connectionString, `INSERT INTO ${table} (${cols}) VALUES (${vals})`, params as any[], {});
    if (!result.success) throw new Error(result.error || "Insert failed");
    insertedCount++;
  }
  logs.push(`Inserted ${insertedCount} rows into ${table}`);
  return { insertedCount, table };
}
