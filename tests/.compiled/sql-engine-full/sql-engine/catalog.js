"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSqlEngineTables = getSqlEngineTables;
exports.getSqlEngineViews = getSqlEngineViews;
exports.getSqlEngineSchemas = getSqlEngineSchemas;
exports.getSqlEngineDatabases = getSqlEngineDatabases;
const detect_1 = require("./detect");
async function getSqlEngineTables(connectionString, schema) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).getSqliteTables(connectionString, schema || "main");
    if (engine === "mysql")
        return (await import("../mysql-client")).getTables(connectionString, schema);
    if (engine === "postgres")
        return (await import("../pg-client")).getTables(connectionString, schema);
    throw new Error("Unsupported SQL engine.");
}
async function getSqlEngineViews(connectionString, schema) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).getSqliteViews(connectionString, schema || "main");
    if (engine === "mysql")
        return (await import("../mysql-client")).getViews(connectionString, schema);
    if (engine === "postgres")
        return (await import("../pg-client")).getViews(connectionString, schema);
    throw new Error("Unsupported SQL engine.");
}
async function getSqlEngineSchemas(connectionString) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite") {
        const schemas = await (await import("../sqlite-client")).getSqliteSchemas(connectionString);
        return schemas.length ? schemas : ["main"];
    }
    if (engine === "mysql")
        return (await import("../mysql-client")).getSchemas(connectionString);
    if (engine === "postgres")
        return (await import("../pg-client")).getSchemas(connectionString);
    throw new Error("Unsupported SQL engine.");
}
async function getSqlEngineDatabases(connectionString) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite")
        return (await import("../sqlite-client")).getSqliteDatabases(connectionString);
    if (engine === "mysql")
        return (await import("../mysql-client")).getDatabases(connectionString);
    if (engine === "postgres")
        return (await import("../pg-client")).getDatabases(connectionString);
    throw new Error("Unsupported SQL engine.");
}
