"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSqlEngineKind = getSqlEngineKind;
exports.isSupportedSqlEngine = isSupportedSqlEngine;
const connection_type_1 = require("../connection-type");
function getSqlEngineKind(connectionString) {
    const dbType = (0, connection_type_1.detectConnectionDbType)(connectionString);
    if (dbType === "postgres")
        return "postgres";
    if (dbType === "sqlite")
        return "sqlite";
    if (dbType === "mysql")
        return "mysql";
    return null;
}
function isSupportedSqlEngine(connectionString) {
    return getSqlEngineKind(connectionString) !== null;
}
