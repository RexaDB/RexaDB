import type { PgCompatTarget } from "./types";
import { quoteIdent, mapTypeName } from "./ddl-shared";
import { renderDefaultExpr } from "./ddl-default";

function renderColumn(target: PgCompatTarget, column: any) {
  const name = quoteIdent(target, column?.name?.name || "");
  const dataTypeName = String(column?.dataType?.name || "text");
  const constraints: any[] = Array.isArray(column?.constraints) ? column.constraints : [];
  const isPrimary = constraints.some((constraint: any) => constraint?.type === "primary key");
  const isNotNull = constraints.some((constraint: any) => constraint?.type === "not null");
  const isUnique = constraints.some((constraint: any) => constraint?.type === "unique");
  const defaultConstraint = constraints.find((constraint: any) => constraint?.type === "default");

  if (target === "sqlite" && isPrimary && ["serial", "bigserial"].includes(dataTypeName.toLowerCase())) {
    return `${name} INTEGER PRIMARY KEY AUTOINCREMENT`;
  }

  const parts = [`${name} ${mapTypeName(target, dataTypeName)}`];
  if (isPrimary) parts.push("PRIMARY KEY");
  if (target === "mysql" && isPrimary && ["serial", "bigserial"].includes(dataTypeName.toLowerCase())) {
    parts.push("AUTO_INCREMENT");
  }
  if (isNotNull) parts.push("NOT NULL");
  if (isUnique) parts.push("UNIQUE");
  if (defaultConstraint?.default) {
    parts.push(`DEFAULT ${renderDefaultExpr(target, defaultConstraint.default)}`);
  }
  const referenceConstraint = constraints.find((constraint: any) => constraint?.type === "reference");
  if (referenceConstraint?.foreignTable?.name) {
    const foreignTable = quoteIdent(target, referenceConstraint.foreignTable.name);
    const foreignColumns = Array.isArray(referenceConstraint.foreignColumns)
      ? referenceConstraint.foreignColumns.map((col: any) => quoteIdent(target, col?.name || "")).join(", ")
      : "";
    parts.push(`REFERENCES ${foreignTable}${foreignColumns ? `(${foreignColumns})` : ""}`);
  }
  return parts.join(" ");
}

export function renderCreateTable(target: PgCompatTarget, statement: any) {
  const tableName = quoteIdent(target, statement?.name?.name || "");
  const columns: any[] = Array.isArray(statement?.columns) ? statement.columns : [];
  const renderedColumns = columns.map((column: any) => renderColumn(target, column));
  return `CREATE TABLE ${tableName} (${renderedColumns.join(", ")})`;
}
