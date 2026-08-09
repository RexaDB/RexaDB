"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSqlEngineQuery = executeSqlEngineQuery;
const detect_1 = require("./detect");
const postgres_compat_1 = require("../postgres-compat");
async function executeSqlEngineQuery(connectionString, query, params = [], options = {}) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite") {
        const { executeSqliteQuery } = await import("../sqlite-client");
        const compiled = (0, postgres_compat_1.compilePostgresQuery)(query, params, "sqlite");
        return await executeSqliteQuery(connectionString, compiled.query, compiled.params);
    }
    if (engine === "mysql") {
        const { executeMysqlSqlEngineQuery } = await import("./mysql-execute");
        return await executeMysqlSqlEngineQuery(connectionString, query, params);
    }
    if (engine === "postgres") {
        const { executeQuery } = await import("../pg-client");
        const compiled = (0, postgres_compat_1.compilePostgresQuery)(query, params, "postgres");
        return await executeQuery(connectionString, compiled.query, compiled.params, options);
    }
    throw new Error("Unsupported SQL engine.");
}
