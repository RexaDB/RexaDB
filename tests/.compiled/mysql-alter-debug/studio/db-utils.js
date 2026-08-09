"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabaseFromConnectionString = getDatabaseFromConnectionString;
exports.updateConnectionStringDatabase = updateConnectionStringDatabase;
exports.getDefaultNewTableColumns = getDefaultNewTableColumns;
const connection_type_1 = require("@/lib/db/connection-type");
const redis_utils_1 = require("@/lib/db/redis-utils");
function getDatabaseFromConnectionString(connectionString) {
    if (!connectionString)
        return "postgres";
    const dbType = (0, connection_type_1.detectConnectionDbType)(connectionString);
    if (dbType === "mongodb") {
        return (0, connection_type_1.getMongoDatabaseFromConnectionString)(connectionString);
    }
    if (dbType === "redis") {
        return (0, redis_utils_1.getRedisDbLabel)(connectionString);
    }
    if (dbType === "trino") {
        try {
            const parsed = new URL(connectionString);
            return parsed.searchParams.get("schema") || "default";
        }
        catch {
            return "default";
        }
    }
    if (dbType === "mssql") {
        try {
            if (connectionString.includes(";")) {
                const parts = connectionString.split(";").map((p) => p.trim()).filter(Boolean);
                for (const part of parts) {
                    const [rawKey, ...rest] = part.split("=");
                    const key = rawKey?.trim().toLowerCase();
                    const value = rest.join("=").trim();
                    if (!key || !value)
                        continue;
                    if (key === "database" || key === "initial catalog")
                        return value;
                }
            }
            const normalized = connectionString.replace(/^sqlserver:/i, "mssql:");
            const url = new URL(normalized);
            const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").trim());
            if (dbName && !dbName.includes("@") && !dbName.includes(":"))
                return dbName;
        }
        catch {
            return "master";
        }
    }
    if (dbType === "mysql") {
        try {
            const normalized = /^(mysql|mariadb):\/(?!\/)/i.test(connectionString)
                ? connectionString.replace(/^((?:mysql|mariadb):)\/(?!\/)/i, "$1//")
                : (connectionString.includes("://") ? connectionString : `mysql://${connectionString}`);
            const url = new URL(normalized);
            const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").trim());
            if (dbName && !dbName.includes("@") && !dbName.includes(":"))
                return dbName;
        }
        catch {
            return "mysql";
        }
    }
    if (dbType === "clickhouse") {
        try {
            const normalized = /^(clickhouse|clickhouses|clickhouse\\+http|clickhouse\\+https):\/\//i.test(connectionString)
                ? connectionString
                    .replace(/^clickhouse\\+http:/i, "http:")
                    .replace(/^clickhouse\\+https:/i, "https:")
                    .replace(/^clickhouse:/i, "http:")
                    .replace(/^clickhouses:/i, "https:")
                : connectionString;
            const url = new URL(normalized);
            const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").trim());
            if (dbName && !dbName.includes("@") && !dbName.includes(":"))
                return dbName;
        }
        catch {
            return "default";
        }
    }
    if (dbType === "sqlite") {
        if (connectionString.trim() === ":memory:")
            return ":memory:";
        if (connectionString.trim().toLowerCase().startsWith("libsql://")) {
            try {
                const parsed = new URL(connectionString.trim());
                const nameFromPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").trim());
                return nameFromPath || parsed.hostname || "turso";
            }
            catch {
                return "turso";
            }
        }
        const raw = connectionString.split("?")[0].split("#")[0].trim();
        const normalized = raw.replace(/^sqlite:\/*/i, "").replace(/^file:\/*/i, "");
        const parts = normalized.split("/").filter(Boolean);
        return parts[parts.length - 1] || "sqlite";
    }
    try {
        const url = new URL(connectionString);
        const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").trim());
        if (dbName && !dbName.includes("@") && !dbName.includes(":"))
            return dbName;
    }
    catch {
        // Fallback below handles malformed connection strings.
    }
    const withoutQuery = connectionString.split("?")[0].split("#")[0];
    const dbCandidate = decodeURIComponent(withoutQuery.split("/").pop()?.trim() || "");
    if (dbCandidate && !dbCandidate.includes("@") && !dbCandidate.includes(":"))
        return dbCandidate;
    if (dbType === "mysql")
        return "mysql";
    if (dbType === "mssql")
        return "master";
    if (dbType === "clickhouse")
        return "default";
    return "postgres";
}
function updateConnectionStringDatabase(connectionString, newDatabase) {
    const dbType = (0, connection_type_1.detectConnectionDbType)(connectionString);
    if (dbType === "sqlite") {
        return connectionString;
    }
    if (dbType === "trino") {
        return connectionString;
    }
    if (dbType === "redis") {
        return (0, redis_utils_1.updateRedisConnectionStringDatabase)(connectionString, newDatabase);
    }
    if (dbType === "mssql" && connectionString.includes(";")) {
        const parts = connectionString.split(";").map((p) => p.trim()).filter(Boolean);
        let replaced = false;
        const updated = parts.map((part) => {
            const [rawKey, ...rest] = part.split("=");
            const key = rawKey?.trim().toLowerCase();
            if (key === "database" || key === "initial catalog") {
                replaced = true;
                return `${rawKey}=${newDatabase}`;
            }
            return part;
        });
        if (!replaced) {
            updated.push(`Database=${newDatabase}`);
        }
        return updated.join(";");
    }
    try {
        const url = new URL(connectionString);
        url.pathname = `/${newDatabase}`;
        return url.toString();
    }
    catch (e) {
        return connectionString;
    }
}
function getDefaultNewTableColumns(dbType) {
    if (dbType === "redis") {
        return [];
    }
    if (dbType === "sqlite") {
        return [
            { name: "id", type: "INTEGER", isPrimary: true, isNullable: false, isUnique: false, default: "" },
            { name: "created_at", type: "TEXT", isPrimary: false, isNullable: false, isUnique: false, default: "CURRENT_TIMESTAMP" },
        ];
    }
    if (dbType === "mssql") {
        return [
            { name: "id", type: "INT", isPrimary: true, isNullable: false, isUnique: false, default: "IDENTITY(1,1)" },
            { name: "created_at", type: "DATETIME2", isPrimary: false, isNullable: false, isUnique: false, default: "SYSUTCDATETIME()" },
        ];
    }
    if (dbType === "mysql") {
        return [
            { name: "id", type: "INT", isPrimary: true, isNullable: false, isUnique: false, default: "AUTO_INCREMENT" },
            { name: "created_at", type: "TIMESTAMP", isPrimary: false, isNullable: false, isUnique: false, default: "CURRENT_TIMESTAMP" },
        ];
    }
    if (dbType === "clickhouse") {
        return [
            { name: "id", type: "UInt64", isPrimary: false, isNullable: false, isUnique: false, default: "" },
            { name: "created_at", type: "DateTime", isPrimary: false, isNullable: false, isUnique: false, default: "now()" },
        ];
    }
    return [
        { name: "id", type: "SERIAL", isPrimary: true, isNullable: false, isUnique: false, default: "" },
        { name: "created_at", type: "TIMESTAMPTZ", isPrimary: false, isNullable: false, isUnique: false, default: "NOW()" },
    ];
}
