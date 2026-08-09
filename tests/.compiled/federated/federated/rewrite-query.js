"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewriteFederatedQuery = rewriteFederatedQuery;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
const ast_1 = require("../postgres-compat/ast");
const normalize_1 = require("../postgres-compat/normalize");
const normalize_rewritten_query_1 = require("./normalize-rewritten-query");
const rewrite_table_1 = require("./rewrite-table");
function rewriteStatement(statement, refs) {
    if (!statement || typeof statement !== "object")
        return statement;
    if (statement?.left || statement?.right) {
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
function rewriteFederatedQuery(query, refs) {
    return (0, normalize_rewritten_query_1.normalizeFederatedRewrittenQuery)(pgsql_ast_parser_1.toSql.statement(rewriteStatement((0, ast_1.parsePostgresStatement)((0, normalize_1.normalizePgSyntax)(query)), refs)));
}
