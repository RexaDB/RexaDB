"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFederatedQueryFromStatement = buildFederatedQueryFromStatement;
exports.buildFederatedColumnMap = buildFederatedColumnMap;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
const normalize_rewritten_query_1 = require("./normalize-rewritten-query");
const rewrite_table_1 = require("./rewrite-table");
const SET_OP_TYPES = new Set(["union", "union all", "intersect", "except"]);
function isWildcardSelect(statement) {
    return statement?.type === "select"
        && Array.isArray(statement?.columns)
        && statement.columns.length === 1
        && statement.columns[0]?.expr?.type === "ref"
        && statement.columns[0]?.expr?.name === "*"
        && Array.isArray(statement?.from)
        && statement.from.length === 1
        && statement.from[0]?.type === "table";
}
function getProjectedColumns(statement, columnMap) {
    if (!statement || typeof statement !== "object")
        return null;
    if (isWildcardSelect(statement)) {
        const tableName = String(statement?.from?.[0]?.name?.name || "");
        return columnMap[tableName] || null;
    }
    if (statement?.type === "select" && Array.isArray(statement?.columns)) {
        const names = statement.columns.map((column) => {
            const alias = String(column?.alias?.name || "").trim();
            if (alias)
                return alias;
            const refName = String(column?.expr?.name || "").trim();
            return refName || "";
        });
        return names.every(Boolean) ? names : null;
    }
    return null;
}
function alignSelectColumns(statement, targetColumns, columnMap) {
    if (!statement || statement?.type !== "select")
        return;
    const currentColumns = getProjectedColumns(statement, columnMap);
    if (!currentColumns || currentColumns.join("|") === targetColumns.join("|"))
        return;
    if (isWildcardSelect(statement)) {
        const available = new Set(currentColumns);
        statement.columns = targetColumns.map((name) => (available.has(name)
            ? { expr: { type: "ref", name }, alias: { name } }
            : { expr: { type: "null" }, alias: { name } }));
        return;
    }
    const byName = new Map(currentColumns.map((name, index) => [name, statement.columns[index]]));
    statement.columns = targetColumns.map((name) => byName.get(name) || { expr: { type: "null" }, alias: { name } });
}
function alignSetOperations(statement, columnMap) {
    if (!statement || typeof statement !== "object")
        return;
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
        for (const binding of statement.bind || [])
            alignSetOperations(binding?.statement, columnMap);
        alignSetOperations(statement.in, columnMap);
    }
}
function rewriteStatement(statement, refs) {
    if (!statement || typeof statement !== "object")
        return statement;
    if (SET_OP_TYPES.has(String(statement?.type || ""))) {
        rewriteStatement(statement.left, refs);
        rewriteStatement(statement.right, refs);
    }
    if (Array.isArray(statement?.from)) {
        statement.from.forEach((entry) => {
            (0, rewrite_table_1.rewriteFederatedTableRef)(entry, refs);
            if (entry?.type === "statement")
                rewriteStatement(entry.statement, refs);
        });
    }
    if (statement?.type === "with") {
        (statement.bind || []).forEach((binding) => rewriteStatement(binding?.statement, refs));
        rewriteStatement(statement.in, refs);
    }
    return statement;
}
function buildFederatedQueryFromStatement(statement, refs, columnMap) {
    const rewritten = rewriteStatement(statement, refs);
    alignSetOperations(rewritten, columnMap);
    return (0, normalize_rewritten_query_1.normalizeFederatedRewrittenQuery)(pgsql_ast_parser_1.toSql.statement(rewritten));
}
function buildFederatedColumnMap(loaded) {
    return Object.fromEntries(loaded.map((entry) => [entry.ref.tempTable, entry.data.columns.map((column) => String(column.name || ""))]));
}
