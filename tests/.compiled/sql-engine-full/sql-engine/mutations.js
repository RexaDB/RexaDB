"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSqlEngineRows = deleteSqlEngineRows;
exports.updateSqlEngineRows = updateSqlEngineRows;
const detect_1 = require("./detect");
async function deleteSqlEngineRows(connectionString, schema, table, pkColumn, pkValues) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).deleteSqliteRows(connectionString, schema, table, pkColumn, pkValues);
    if (engine === "mysql")
        return (await import("../mysql-client")).deleteRows(connectionString, schema, table, pkColumn, pkValues);
    if (engine === "postgres")
        return (await import("../pg-client")).deleteRows(connectionString, schema, table, pkColumn, pkValues);
    throw new Error("Unsupported SQL engine.");
}
async function updateSqlEngineRows(connectionString, schema, table, updates) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).updateSqliteRows(connectionString, schema, table, updates);
    if (engine === "mysql")
        return (await import("../mysql-client")).updateRows(connectionString, schema, table, updates);
    if (engine === "postgres")
        return (await import("../pg-client")).updateRows(connectionString, schema, table, updates);
    throw new Error("Unsupported SQL engine.");
}
