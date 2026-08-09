"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripReturningClause = stripReturningClause;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
const ast_1 = require("./ast");
const normalize_1 = require("./normalize");
function stripReturningClause(query) {
    const statement = (0, ast_1.parsePostgresStatement)((0, normalize_1.normalizePgSyntax)(query));
    if (Array.isArray(statement?.returning)) {
        delete statement.returning;
    }
    return pgsql_ast_parser_1.toSql.statement(statement);
}
