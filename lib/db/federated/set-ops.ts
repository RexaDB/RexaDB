import { toSql } from "pgsql-ast-parser";
import { normalizePgSyntax } from "../postgres-compat/normalize";
import { normalizeFederatedRewrittenQuery } from "./normalize-rewritten-query";
import { walkAstFromAndWith } from "./rewrite-table";
import type { FederatedTableRef } from "./types";

const SET_OP_TYPES = new Set(["union", "union all", "intersect", "except"]);

function isWildcardSelect(statement: any) {
  return statement?.type === "select"
    && Array.isArray(statement?.columns)
    && statement.columns.length === 1
    && statement.columns[0]?.expr?.type === "ref"
    && statement.columns[0]?.expr?.name === "*"
    && Array.isArray(statement?.from)
    && statement.from.length === 1
    && statement.from[0]?.type === "table";
}

function getProjectedColumns(statement: any, columnMap: Record<string, string[]>) {
  if (!statement || typeof statement !== "object") return null;
  if (isWildcardSelect(statement)) {
    const tableName = String(statement?.from?.[0]?.name?.name || "");
    return columnMap[tableName] || null;
  }
  if (statement?.type === "select" && Array.isArray(statement?.columns)) {
    const names = statement.columns.map((column: any) => {
      const alias = String(column?.alias?.name || "").trim();
      if (alias) return alias;
      const refName = String(column?.expr?.name || "").trim();
      return refName || "";
    });
    return names.every(Boolean) ? names : null;
  }
  return null;
}

function alignSelectColumns(statement: any, targetColumns: string[], columnMap: Record<string, string[]>) {
  if (!statement || statement?.type !== "select") return;
  const currentColumns = getProjectedColumns(statement, columnMap);
  if (!currentColumns || currentColumns.join("|") === targetColumns.join("|")) return;

  if (isWildcardSelect(statement)) {
    const available = new Set(currentColumns);
    statement.columns = targetColumns.map((name) => (
      available.has(name)
        ? { expr: { type: "ref", name }, alias: { name } }
        : { expr: { type: "null" }, alias: { name } }
    ));
    return;
  }

  const byName = new Map(currentColumns.map((name: string, index: number) => [name, statement.columns[index]]));
  statement.columns = targetColumns.map((name) => byName.get(name) || { expr: { type: "null" }, alias: { name } });
}

function alignSetOperations(statement: any, columnMap: Record<string, string[]>) {
  if (!statement || typeof statement !== "object") return;
  if (SET_OP_TYPES.has(String(statement?.type || ""))) {
    alignSetOperations(statement.left, columnMap);
    alignSetOperations(statement.right, columnMap);
    const leftColumns = getProjectedColumns(statement.left, columnMap);
    const rightColumns = getProjectedColumns(statement.right, columnMap);
    if (leftColumns && rightColumns) {
      const targetColumns = Array.from(new Set([...leftColumns, ...rightColumns]));
      alignSelectColumns(statement.left, targetColumns, columnMap);
      alignSelectColumns(statement.right, targetColumns, columnMap);
    }
    return;
  }
  if (statement?.type === "with") {
    for (const binding of statement.bind || []) alignSetOperations(binding?.statement, columnMap);
    alignSetOperations(statement.in, columnMap);
  }
}

function rewriteStatement(statement: any, refs: FederatedTableRef[]): any {
  if (!statement || typeof statement !== "object") return statement;
  if (SET_OP_TYPES.has(String(statement?.type || ""))) {
    rewriteStatement(statement.left, refs);
    rewriteStatement(statement.right, refs);
  }
  walkAstFromAndWith(statement, refs, (stmt) => rewriteStatement(stmt, refs));
  return statement;
}

export function buildFederatedQueryFromStatement(
  statement: any,
  refs: FederatedTableRef[],
  columnMap: Record<string, string[]>
) {
  const rewritten = rewriteStatement(statement, refs);
  alignSetOperations(rewritten, columnMap);
  return normalizeFederatedRewrittenQuery(toSql.statement(rewritten));
}

export function buildFederatedColumnMap(
  loaded: Array<{ ref: FederatedTableRef; data: { columns: Array<{ name: string }> } }>
) {
  return Object.fromEntries(
    loaded.map((entry) => [entry.ref.tempTable, entry.data.columns.map((column) => String(column.name || ""))])
  );
}
