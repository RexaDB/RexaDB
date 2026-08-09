import type { PgCompatTarget } from "./types";
import { renderAlterColumn } from "./ddl-alter-column";
import { renderAddedConstraint } from "./ddl-constraints";
import { quoteIdent, mapTypeName } from "./ddl-shared";
import { renderDefaultExpr } from "./ddl-default";

function renderAddedColumn(target: PgCompatTarget, column: any) {
  const name = quoteIdent(target, column?.name?.name || "");
  const dataType = mapTypeName(target, String(column?.dataType?.name || "text"));
  const constraints: any[] = Array.isArray(column?.constraints) ? column.constraints : [];
  const parts = [`${name} ${dataType}`];
  if (constraints.some((constraint: any) => constraint?.type === "not null")) parts.push("NOT NULL");
  const defaultConstraint = constraints.find((constraint: any) => constraint?.type === "default");
  if (defaultConstraint?.default) parts.push(`DEFAULT ${renderDefaultExpr(target, defaultConstraint.default)}`);
  return parts.join(" ");
}

export function renderAlterTable(target: PgCompatTarget, statement: any) {
  const tableName = quoteIdent(target, statement?.table?.name || "");
  const changes = Array.isArray(statement?.changes) ? statement.changes : [];
  if (changes.length !== 1) throw new Error("ALTER TABLE compatibility currently supports one change per statement.");
  const change = changes[0];
  if (change?.type === "add column") {
    return `ALTER TABLE ${tableName} ADD COLUMN ${renderAddedColumn(target, change.column)}`;
  }
  if (change?.type === "drop column") {
    return `ALTER TABLE ${tableName} DROP COLUMN ${quoteIdent(target, change?.column?.name || "")}`;
  }
  if (change?.type === "rename column") {
    const from = quoteIdent(target, change?.column?.name || "");
    const to = quoteIdent(target, change?.to?.name || "");
    return `ALTER TABLE ${tableName} RENAME COLUMN ${from} TO ${to}`;
  }
  if (change?.type === "rename") {
    return `ALTER TABLE ${tableName} RENAME TO ${quoteIdent(target, change?.to?.name || "")}`;
  }
  if (change?.type === "alter column") {
    return `ALTER TABLE ${tableName} ${renderAlterColumn(target, change)}`;
  }
  if (change?.type === "add constraint") {
    if (target === "sqlite") throw new Error("SQLite does not safely support ALTER TABLE ADD CONSTRAINT.");
    return `ALTER TABLE ${tableName} ${renderAddedConstraint(target, change.constraint)}`;
  }
  if (change?.type === "drop constraint") {
    throw new Error(`ALTER TABLE DROP CONSTRAINT is not safely supported for ${target} yet.`);
  }
  if (change?.type === "rename constraint") {
    throw new Error(`ALTER TABLE RENAME CONSTRAINT is not safely supported for ${target} yet.`);
  }
  throw new Error(`Unsupported ALTER TABLE change: ${String(change?.type || "unknown")}.`);
}
