"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePostgresStatement = parsePostgresStatement;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
function parsePostgresStatement(query) {
    return (0, pgsql_ast_parser_1.parseFirst)(String(query || ""));
}
