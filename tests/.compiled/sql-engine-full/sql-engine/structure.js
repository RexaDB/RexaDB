"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSqlEngineTableStructure = getSqlEngineTableStructure;
exports.getSqlEngineTableForeignKeys = getSqlEngineTableForeignKeys;
exports.getSqlEnginePrimaryKey = getSqlEnginePrimaryKey;
const detect_1 = require("./detect");
async function getSqlEngineTableStructure(connectionString, schema, table) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).getSqliteTableStructure(connectionString, schema, table);
    if (engine === "mysql")
        return (await import("../mysql-client")).getTableStructure(connectionString, schema, table);
    if (engine === "postgres")
        return (await import("../pg-client")).getTableStructure(connectionString, schema, table);
    throw new Error("Unsupported SQL engine.");
}
async function getSqlEngineTableForeignKeys(connectionString, schema, table) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).getSqliteForeignKeys(connectionString, schema, table);
    if (engine === "mysql")
        return (await import("../mysql-client")).getTableForeignKeys(connectionString, schema, table);
    if (engine === "postgres")
        return (await import("../pg-client")).getTableForeignKeys(connectionString, schema, table);
    throw new Error("Unsupported SQL engine.");
}
async function getSqlEnginePrimaryKey(connectionString, schema, table) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).getSqlitePrimaryKey(connectionString, schema, table);
    if (engine === "mysql")
        return (await import("../mysql-client")).getTablePrimaryKey(connectionString, schema, table);
    if (engine === "postgres")
        return (await import("../pg-client")).getTablePrimaryKey(connectionString, schema, table);
    throw new Error("Unsupported SQL engine.");
}
