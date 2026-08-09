"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasReturningClause = hasReturningClause;
const ast_1 = require("./ast");
const normalize_1 = require("./normalize");
function hasReturningClause(query) {
    const statement = (0, ast_1.parsePostgresStatement)((0, normalize_1.normalizePgSyntax)(query));
    return Array.isArray(statement?.returning) && statement.returning.length > 0;
}
