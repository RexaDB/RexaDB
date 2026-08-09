import { toSql } from "pgsql-ast-parser";
import type { PgCompatTarget } from "./types";

export function renderGenericDdl(target: PgCompatTarget, statement: any) {
  const sql = toSql.statement(statement);
  return target === "mysql" ? sql.replace(/"/g, "`") : sql;
}
