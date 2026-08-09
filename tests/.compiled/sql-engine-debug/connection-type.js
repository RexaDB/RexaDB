"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectConnectionDbType = detectConnectionDbType;
exports.getMongoDatabaseFromConnectionString = getMongoDatabaseFromConnectionString;
function isLikelyTrinoHttpUrl(connectionString) {
    try {
        const parsed = new URL(String(connectionString || "").trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return false;
        const host = parsed.hostname.toLowerCase();
        const path = (parsed.pathname || "").toLowerCase();
        if (host.includes("trino"))
            return true;
        if (path.includes("/v1/statement") || path === "/ui" || path === "/ui/")
            return true;
        if (parsed.searchParams.has("catalog") || parsed.searchParams.has("schema"))
            return true;
        return false;
    }
    catch {
        return false;
    }
}
function isSqliteConnectionString(connectionString) {
    const raw = String(connectionString || "").trim().toLowerCase();
    const hasExplicitProtocol = raw.includes("://");
    return raw === ":memory:"
        || raw.startsWith("libsql://")
        || raw.startsWith("sqlite:")
        || raw.startsWith("file:")
        || (!hasExplicitProtocol && (raw.endsWith(".db")
            || raw.endsWith(".sqlite")
            || raw.endsWith(".sqlite3")));
}
function isMysqlConnectionString(connectionString) {
    const raw = String(connectionString || "").trim().toLowerCase();
    if (raw.startsWith("mysql://")
        || raw.startsWith("mariadb://")
        || raw.startsWith("mysql:/")
        || raw.startsWith("mariadb:/")) {
        return true;
    }
    if (!raw.includes("://")) {
        return /:(3306|33060)(?:\/|$)/.test(raw);
    }
    return false;
}
function detectConnectionDbType(connectionString) {
    const raw = String(connectionString || "").trim().toLowerCase();
    if (isLikelyTrinoHttpUrl(connectionString)) {
        return "trino";
    }
    if (raw.startsWith("trino://")
        || raw.startsWith("trino+http://")
        || raw.startsWith("trino+https://")) {
        return "trino";
    }
    if (raw.startsWith("mssql://") || raw.startsWith("sqlserver://") || raw.startsWith("sqlserver:/")) {
        return "mssql";
    }
    if (raw.includes("server=") && (raw.includes("database=") || raw.includes("initial catalog="))) {
        return "mssql";
    }
    if (raw.startsWith("clickhouse://")
        || raw.startsWith("clickhouses://")
        || raw.startsWith("clickhouse+http://")
        || raw.startsWith("clickhouse+https://")) {
        return "clickhouse";
    }
    if (raw.startsWith("redis://") || raw.startsWith("rediss://")) {
        return "redis";
    }
    if (raw.startsWith("mongodb://") || raw.startsWith("mongodb+srv://")) {
        return "mongodb";
    }
    if (isMysqlConnectionString(connectionString)) {
        return "mysql";
    }
    if (isSqliteConnectionString(connectionString)) {
        return "sqlite";
    }
    return "postgres";
}
function getMongoDatabaseFromConnectionString(connectionString) {
    try {
        const parsed = new URL(String(connectionString || "").trim());
        if (!/^mongodb(\+srv)?:$/i.test(parsed.protocol))
            return "admin";
        const pathname = decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, "").trim());
        return pathname || "admin";
    }
    catch {
        return "admin";
    }
}
