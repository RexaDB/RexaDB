import { toSql } from "pgsql-ast-parser";
import type { PgCompatTarget } from "./types";
import { quoteIdent } from "./ddl-shared";

function quoteColumnList(target: PgCompatTarget, columns: any[] = []) {
  return columns.map((column: any) => quoteIdent(target, column?.name || "")).join(", ");
}

function quoteMysqlExpr(sql: string) {
  return sql.replace(/"/g, "`");
}

export function renderAddedConstraint(target: PgCompatTarget, constraint: any) {
  const name = constraint?.constraintName?.name;
  const prefix = name ? `CONSTRAINT ${quoteIdent(target, name)} ` : "";
  if (constraint?.type === "unique") {
    return `ADD ${prefix}UNIQUE (${quoteColumnList(target, constraint.columns)})`;
  }
  if (constraint?.type === "primary key") {
    return `ADD ${prefix}PRIMARY KEY (${quoteColumnList(target, constraint.columns)})`;
  }
  if (constraint?.type === "foreign key") {
    const local = quoteColumnList(target, constraint.localColumns);
    const foreign = quoteColumnList(target, constraint.foreignColumns);
    const table = quoteIdent(target, constraint?.foreignTable?.name || "");
    return `ADD ${prefix}FOREIGN KEY (${local}) REFERENCES ${table} (${foreign})`;
  }
  if (constraint?.type === "check") {
    const expr = toSql.expr(constraint.expr);
    return `ADD ${prefix}CHECK (${target === "mysql" ? quoteMysqlExpr(expr) : expr})`;
  }
  throw new Error(`Unsupported constraint type: ${String(constraint?.type || "unknown")}.`);
}
