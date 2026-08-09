"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGenericDdl = renderGenericDdl;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
function renderGenericDdl(target, statement) {
    const sql = pgsql_ast_parser_1.toSql.statement(statement);
    return target === "mysql" ? sql.replace(/"/g, "`") : sql;
}
