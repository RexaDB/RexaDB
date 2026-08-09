"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeMysqlSqlEngineQuery = executeMysqlSqlEngineQuery;
function getMysqlExecutor() {
    const override = globalThis
        .__mysqlExecuteTestState?.executeMysqlQuery;
    if (override)
        return override;
    return import("../mysql-client").then((mod) => mod.executeMysqlQuery);
}
async function executeMysqlSqlEngineQuery(connectionString, query, params = []) {
    const executeMysqlQuery = await getMysqlExecutor();
    return await executeMysqlQuery(connectionString, query, params);
}
