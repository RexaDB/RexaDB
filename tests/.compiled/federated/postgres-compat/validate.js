"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSupportedStatement = assertSupportedStatement;
const statement_kind_1 = require("./statement-kind");
const SUPPORTED_KINDS = new Set([
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "ALTER",
    "DROP",
]);
function assertSupportedStatement(query) {
    const kind = (0, statement_kind_1.getStatementKind)(query);
    if (SUPPORTED_KINDS.has(kind))
        return;
    throw new Error(`Postgres compatibility compiler does not support ${kind || "unknown"} yet.`);
}
