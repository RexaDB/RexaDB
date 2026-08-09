import { toSql } from "pgsql-ast-parser";
import type { PgCompatTarget } from "./types";

export function renderDefaultExpr(target: PgCompatTarget, expr: any) {
  if (expr?.type === "call" && String(expr?.function?.name || "").toLowerCase() === "now") {
    return "CURRENT_TIMESTAMP";
  }
  const sql = toSql.expr(expr);
  if (target === "mysql") return sql.replace(/"/g, "`");
  return sql;
}
