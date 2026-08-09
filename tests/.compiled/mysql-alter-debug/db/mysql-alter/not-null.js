"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMysqlNotNullAlterQuery = isMysqlNotNullAlterQuery;
exports.executeMysqlNotNullAlterQuery = executeMysqlNotNullAlterQuery;
const ast_1 = require("../postgres-compat/ast");
const normalize_1 = require("../postgres-compat/normalize");
const db_utils_1 = require("../../studio/db-utils");
const column_definition_1 = require("./column-definition");
const quote_1 = require("./quote");
function getNotNullAlterChange(statement) {
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
    return change;
}
function isMysqlNotNullAlterQuery(query) {
    return Boolean(getNotNullAlterChange((0, ast_1.parsePostgresStatement)((0, normalize_1.normalizePgSyntax)(query))));
}
async function executeMysqlNotNullAlterQuery(connectionString, query) {
    const statement = (0, ast_1.parsePostgresStatement)((0, normalize_1.normalizePgSyntax)(query));
    const change = getNotNullAlterChange(statement);
    if (!change)
        throw new Error("MySQL ALTER planner received an unsupported query.");
    const databaseName = (0, db_utils_1.getDatabaseFromConnectionString)(connectionString);
    const tableName = String(statement?.table?.name || "");
    const columnName = String(change?.column?.name || "");
    if (!databaseName || !tableName || !columnName)
        throw new Error("MySQL ALTER planner requires database, table, and column names.");
    const { executeMysqlQuery, getTableStructure } = await import("../mysql-client");
    const columns = await getTableStructure(connectionString, databaseName, tableName);
    const column = columns.find((entry) => String(entry?.column_name || "") === columnName);
    if (!column)
        throw new Error(`Column "${columnName}" not found in ${tableName}.`);
    const nullable = String(change.alter.type) === "drop not null";
    const tableRef = `${(0, quote_1.quoteMysqlIdentifier)(databaseName)}.${(0, quote_1.quoteMysqlIdentifier)(tableName)}`;
    const definition = (0, column_definition_1.buildMysqlColumnDefinition)(column, nullable);
    return await executeMysqlQuery(connectionString, `ALTER TABLE ${tableRef} MODIFY COLUMN ${definition}`);
}
