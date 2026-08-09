"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMysqlNotNullAlterChange = getMysqlNotNullAlterChange;
exports.isMysqlNotNullAlterQuery = isMysqlNotNullAlterQuery;
const ast_1 = require("../postgres-compat/ast");
const normalize_1 = require("../postgres-compat/normalize");
function getMysqlNotNullAlterChange(query) {
    const statement = (0, ast_1.parsePostgresStatement)((0, normalize_1.normalizePgSyntax)(query));
    if (statement?.type !== "alter table")
        return null;
    const changes = Array.isArray(statement?.changes) ? statement.changes : [];
    if (changes.length !== 1)
        return null;
    const change = changes[0];
    const alterType = String(change?.alter?.type || "");
    if (change?.type !== "alter column")
        return null;
    if (alterType !== "set not null" && alterType !== "drop not null")
        return null;
    return { statement, change };
}
function isMysqlNotNullAlterQuery(query) {
    return Boolean(getMysqlNotNullAlterChange(query));
}
