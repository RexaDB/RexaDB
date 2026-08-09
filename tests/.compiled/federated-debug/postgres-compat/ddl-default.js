"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDefaultExpr = renderDefaultExpr;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
function renderDefaultExpr(target, expr) {
    if (expr?.type === "call" && String(expr?.function?.name || "").toLowerCase() === "now") {
        return "CURRENT_TIMESTAMP";
    }
    const sql = pgsql_ast_parser_1.toSql.expr(expr);
    if (target === "mysql")
        return sql.replace(/"/g, "`");
    return sql;
}
