"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSqliteConnectionString = isSqliteConnectionString;
exports.resolveSqlitePath = resolveSqlitePath;
exports.executeSqliteQuery = executeSqliteQuery;
exports.getSqliteTables = getSqliteTables;
exports.getSqliteViews = getSqliteViews;
exports.getSqliteSchemas = getSqliteSchemas;
exports.getSqliteDatabases = getSqliteDatabases;
exports.getSqliteTableStructure = getSqliteTableStructure;
exports.getSqlitePrimaryKey = getSqlitePrimaryKey;
exports.getSqliteForeignKeys = getSqliteForeignKeys;
exports.deleteSqliteRows = deleteSqliteRows;
exports.updateSqliteRows = updateSqliteRows;
exports.getSqliteReferencedRecord = getSqliteReferencedRecord;
exports.getSqliteAllTablesWithColumns = getSqliteAllTablesWithColumns;
const path_1 = __importDefault(require("path"));
function toPlainValue(value) {
    if (value === null || value === undefined)
        return value ?? null;
    if (typeof value === "bigint") {
        const asNumber = Number(value);
        return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
    }
    if (value instanceof Date)
        return value.toISOString();
    if (value instanceof Uint8Array)
        return Buffer.from(value).toString("hex");
    if (Array.isArray(value))
        return value.map((item) => toPlainValue(item));
    if (typeof value === "object") {
        const out = {};
        for (const [key, nested] of Object.entries(value)) {
            out[key] = toPlainValue(nested);
        }
        return out;
    }
    return value;
}
function toPlainRow(row) {
    if (!row || typeof row !== "object")
        return {};
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = toPlainValue(value);
    }
    return out;
}
function toPlainRows(rows) {
    return rows.map((row) => toPlainRow(row));
}
function quoteIdentifier(value) {
    return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}
function isSqliteConnectionString(connectionString) {
    const raw = String(connectionString || "").trim().toLowerCase();
    const hasExplicitProtocol = raw.includes("://");
    return raw === ":memory:"
        || raw.startsWith("libsql://")
        || raw.startsWith("sqlite:")
        || raw.startsWith("file:")
        || raw.startsWith("/")
        || /^[a-z]:[\\\/]/i.test(raw)
        || raw.startsWith("./")
        || raw.startsWith("../")
        || raw.startsWith("~")
        || (!hasExplicitProtocol && raw.length > 0 && !raw.includes("=") && !raw.includes("@"));
}
function normalizeFsPath(decodedPath) {
    if (/^\/[a-zA-Z]:\//.test(decodedPath)) {
        return decodedPath.slice(1);
    }
    return decodedPath;
}
function parseFileUriPath(input) {
    const parsed = new URL(input);
    if (parsed.protocol !== "file:") {
        throw new Error("Only file: URIs are supported for SQLite.");
    }
    return normalizeFsPath(decodeURIComponent(parsed.pathname || ""));
}
function resolveSqlitePath(connectionString) {
    let raw = String(connectionString || "").trim();
    if (!raw) {
        throw new Error("SQLite connection string is required.");
    }
    if (raw === ":memory:") {
        return raw;
    }
    if (raw.startsWith("sqlite://")) {
        raw = decodeURIComponent(raw.slice("sqlite://".length));
        if (!raw)
            throw new Error("SQLite file path is missing.");
        if (raw.startsWith("/"))
            return raw;
        return path_1.default.isAbsolute(raw) ? raw : path_1.default.resolve(process.cwd(), raw);
    }
    if (raw.startsWith("sqlite:")) {
        raw = decodeURIComponent(raw.slice("sqlite:".length));
        if (!raw)
            throw new Error("SQLite file path is missing.");
        if (raw.startsWith("//")) {
            const fromUri = parseFileUriPath(`file:${raw}`);
            if (fromUri.startsWith("/"))
                return fromUri;
            return path_1.default.isAbsolute(fromUri) ? fromUri : path_1.default.resolve(process.cwd(), fromUri);
        }
        if (raw.startsWith("/"))
            return raw;
        return path_1.default.isAbsolute(raw) ? raw : path_1.default.resolve(process.cwd(), raw);
    }
    if (raw.startsWith("file:")) {
        const fromUri = parseFileUriPath(raw);
        if (fromUri.startsWith("/"))
            return fromUri;
        return path_1.default.isAbsolute(fromUri) ? fromUri : path_1.default.resolve(process.cwd(), fromUri);
    }
    if (raw.includes("://")) {
        throw new Error("Unsupported SQLite connection string.");
    }
    if (raw.startsWith("/"))
        return raw;
    return path_1.default.isAbsolute(raw) ? raw : path_1.default.resolve(process.cwd(), raw);
}
function resolveSqliteTarget(connectionString) {
    const raw = String(connectionString || "").trim();
    const lower = raw.toLowerCase();
    if (lower.startsWith("libsql://") || lower.startsWith("https://") || lower.startsWith("http://")) {
        try {
            const parsed = new URL(raw);
            const authToken = parsed.searchParams.get("authToken") || parsed.searchParams.get("auth_token") || undefined;
            if (authToken) {
                parsed.searchParams.delete("authToken");
                parsed.searchParams.delete("auth_token");
            }
            return {
                mode: "remote",
                remoteUrl: parsed.toString(),
                authToken,
            };
        }
        catch {
            return {
                mode: "remote",
                remoteUrl: raw,
            };
        }
    }
    return {
        mode: "local",
        localPath: resolveSqlitePath(connectionString),
    };
}
function getDatabaseLabel(connectionString) {
    const target = resolveSqliteTarget(connectionString);
    if (target.mode === "remote") {
        try {
            const parsed = new URL(target.remoteUrl || "");
            return parsed.hostname || target.remoteUrl || "turso";
        }
        catch {
            return target.remoteUrl || "turso";
        }
    }
    const sqlitePath = target.localPath || resolveSqlitePath(connectionString);
    if (sqlitePath === ":memory:")
        return ":memory:";
    return path_1.default.basename(sqlitePath);
}
function normalizeSqliteArg(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string"
        || typeof value === "number"
        || typeof value === "bigint"
        || typeof value === "boolean"
        || value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof Date)
        return value.toISOString();
    return JSON.stringify(value);
}
function normalizeSqliteArgs(args) {
    return Array.isArray(args) ? args.map(normalizeSqliteArg) : [];
}
function isBetterSqliteNativeLoadError(error) {
    const message = String(error?.message || error || "");
    return message.includes("NODE_MODULE_VERSION")
        || message.includes("compiled against a different Node.js version")
        || message.includes("better_sqlite3.node");
}
async function createBetterSqliteDriver(sqlitePath) {
    const mod = await import("better-sqlite3");
    const BetterSqlite3 = (mod.default ?? mod);
    const db = new BetterSqlite3(sqlitePath);
    db.pragma("foreign_keys = ON");
    return {
        all: async (sql, args) => {
            const normalized = normalizeSqliteArgs(args);
            const stmt = db.prepare(sql);
            const rows = (normalized.length ? stmt.all(...normalized) : stmt.all());
            return toPlainRows(rows);
        },
        get: async (sql, args) => {
            const normalized = normalizeSqliteArgs(args);
            const stmt = db.prepare(sql);
            const row = normalized.length ? stmt.get(...normalized) : stmt.get();
            return row ? toPlainRow(row) : null;
        },
        run: async (sql, args) => {
            const normalized = normalizeSqliteArgs(args);
            if (normalized.length > 0) {
                const info = db.prepare(sql).run(...normalized);
                return { changes: Number(info.changes || 0) };
            }
            try {
                const info = db.prepare(sql).run();
                return { changes: Number(info.changes || 0) };
            }
            catch {
                db.exec(sql);
                return { changes: 0 };
            }
        },
        close: async () => {
            db.close();
        },
    };
}
async function createLibsqlDriver(target) {
    const { createClient } = await import("@libsql/client/node");
    const url = target.mode === "remote"
        ? String(target.remoteUrl || "")
        : (target.localPath === ":memory:" ? "file::memory:" : `file:${target.localPath}`);
    const client = createClient({
        url,
        authToken: target.authToken,
    });
    await client.execute("PRAGMA foreign_keys = ON");
    return {
        all: async (sql, args) => {
            const res = await client.execute({ sql, args: normalizeSqliteArgs(args) });
            return toPlainRows(res.rows);
        },
        get: async (sql, args) => {
            const res = await client.execute({ sql, args: normalizeSqliteArgs(args) });
            const rows = toPlainRows(res.rows);
            return rows[0] ?? null;
        },
        run: async (sql, args) => {
            const res = await client.execute({ sql, args: normalizeSqliteArgs(args) });
            return { changes: Number(res.rowsAffected || 0) };
        },
        close: async () => {
            try {
                const maybeClose = client.close;
                await maybeClose?.();
            }
            catch { }
        },
    };
}
async function createSqliteDriver(connectionString) {
    const target = resolveSqliteTarget(connectionString);
    if (target.mode === "remote") {
        return await createLibsqlDriver(target);
    }
    const sqlitePath = target.localPath || resolveSqlitePath(connectionString);
    try {
        return await createBetterSqliteDriver(sqlitePath);
    }
    catch (error) {
        if (!isBetterSqliteNativeLoadError(error))
            throw error;
        console.warn("SQLite native driver unavailable, falling back to libsql client.");
        return await createLibsqlDriver(target);
    }
}
async function withDb(connectionString, fn) {
    const db = await createSqliteDriver(connectionString);
    try {
        return await fn(db);
    }
    finally {
        await db.close();
    }
}
function buildFieldList(rows) {
    if (!rows.length)
        return [];
    return Object.keys(rows[0]).map((name) => ({
        name,
        dataTypeID: 0,
        dataTypeName: "unknown",
    }));
}
function getOperation(query) {
    return (String(query || "").trim().match(/^\s*([a-z]+)/i)?.[1] || "").toUpperCase();
}
function assertSupportedSqliteStatement(query) {
    const trimmed = String(query || "").trim();
    if (/^CREATE\s+SCHEMA\b/i.test(trimmed)) {
        throw new Error('SQLite does not support CREATE SCHEMA. Use ATTACH DATABASE to add another database, or create tables in "main".');
    }
}
async function executeSqliteQuery(connectionString, query, params = []) {
    return await withDb(connectionString, async (db) => {
        const trimmed = String(query || "").trim();
        if (!trimmed) {
            return { rows: [], fields: [], rowCount: 0 };
        }
        assertSupportedSqliteStatement(trimmed);
        const operation = getOperation(trimmed);
        const isRowReturning = ["SELECT", "PRAGMA", "WITH", "EXPLAIN"].includes(operation);
        if (isRowReturning) {
            const rows = await db.all(query, params);
            const fields = buildFieldList(rows);
            return {
                rows,
                fields,
                rowCount: rows.length,
            };
        }
        const info = await db.run(query, params);
        return {
            rows: [],
            fields: [],
            rowCount: Number(info.changes || 0),
        };
    });
}
async function getSqliteTables(connectionString, schema) {
    return await withDb(connectionString, async (db) => {
        const rows = await db.all(`SELECT name FROM ${quoteIdentifier(schema)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
        return rows.map((row) => String(row.name));
    });
}
async function getSqliteViews(connectionString, schema) {
    return await withDb(connectionString, async (db) => {
        const rows = await db.all(`SELECT name FROM ${quoteIdentifier(schema)}.sqlite_master WHERE type = 'view' ORDER BY name`);
        return rows.map((row) => String(row.name));
    });
}
async function getSqliteSchemas(connectionString) {
    return await withDb(connectionString, async (db) => {
        const rows = await db.all("PRAGMA database_list;");
        return rows.map((row) => String(row.name)).filter(Boolean);
    });
}
async function getSqliteDatabases(connectionString) {
    return [getDatabaseLabel(connectionString)];
}
async function getSqliteTableStructure(connectionString, schema, table) {
    return await withDb(connectionString, async (db) => {
        const tableInfo = await db.all(`PRAGMA ${quoteIdentifier(schema)}.table_info(${quoteIdentifier(table)});`);
        const foreignKeys = await db.all(`PRAGMA ${quoteIdentifier(schema)}.foreign_key_list(${quoteIdentifier(table)});`);
        const fkColumns = new Set(foreignKeys.map((fk) => fk.from));
        return tableInfo.map((column) => ({
            column_name: column.name,
            data_type: column.type || "TEXT",
            is_nullable: column.notnull ? "NO" : "YES",
            column_default: column.dflt_value,
            is_primary_key: Number(column.pk || 0) > 0,
            is_foreign_key: fkColumns.has(column.name),
        }));
    });
}
async function getSqlitePrimaryKey(connectionString, schema, table) {
    return await withDb(connectionString, async (db) => {
        const tableInfo = await db.all(`PRAGMA ${quoteIdentifier(schema)}.table_info(${quoteIdentifier(table)});`);
        const orderedPkColumns = tableInfo
            .filter((column) => Number(column.pk || 0) > 0)
            .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0));
        return orderedPkColumns[0]?.name || null;
    });
}
async function getSqliteForeignKeys(connectionString, schema, table) {
    return await withDb(connectionString, async (db) => {
        const foreignKeys = await db.all(`PRAGMA ${quoteIdentifier(schema)}.foreign_key_list(${quoteIdentifier(table)});`);
        return foreignKeys.map((fk) => ({
            column_name: fk.from,
            foreign_table_schema: schema,
            foreign_table_name: fk.table,
            foreign_column_name: fk.to,
        }));
    });
}
async function deleteSqliteRows(connectionString, schema, table, pkColumn, pkValues) {
    return await withDb(connectionString, async (db) => {
        const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
        const placeholders = pkValues.map(() => "?").join(", ");
        const info = await db.run(`DELETE FROM ${tableRef} WHERE ${quoteIdentifier(pkColumn)} IN (${placeholders})`, pkValues);
        return { rowCount: Number(info.changes || 0) };
    });
}
async function updateSqliteRows(connectionString, schema, table, updates) {
    return await withDb(connectionString, async (db) => {
        const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
        await db.run("BEGIN");
        try {
            for (const update of updates) {
                const setEntries = Object.entries(update.set);
                const whereEntries = Object.entries(update.where);
                if (setEntries.length === 0 || whereEntries.length === 0)
                    continue;
                const setClause = setEntries.map(([name]) => `${quoteIdentifier(name)} = ?`).join(", ");
                const whereClause = whereEntries.map(([name]) => `${quoteIdentifier(name)} = ?`).join(" AND ");
                const values = [...setEntries.map(([, value]) => value), ...whereEntries.map(([, value]) => value)];
                await db.run(`UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`, values);
            }
            await db.run("COMMIT");
        }
        catch (error) {
            await db.run("ROLLBACK");
            throw error;
        }
        return { success: true };
    });
}
async function getSqliteReferencedRecord(connectionString, schema, table, keyValues) {
    return await withDb(connectionString, async (db) => {
        const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
        const entries = Object.entries(keyValues || {}).filter(([key]) => key);
        if (entries.length === 0) {
            return { row: null, fields: [] };
        }
        const conditions = [];
        const values = [];
        for (const [key, val] of entries) {
            if (val === null) {
                conditions.push(`${quoteIdentifier(key)} IS NULL`);
            }
            else {
                conditions.push(`${quoteIdentifier(key)} = ?`);
                values.push(val);
            }
        }
        const row = await db.get(`SELECT * FROM ${tableRef} WHERE ${conditions.join(" AND ")} LIMIT 1`, values);
        const fields = row
            ? Object.keys(row).map((name) => ({ name, dataTypeID: 0, dataTypeName: "unknown" }))
            : [];
        return { row, fields };
    });
}
async function getSqliteAllTablesWithColumns(connectionString, schema) {
    return await withDb(connectionString, async (db) => {
        const schemas = await db.all("PRAGMA database_list;");
        const rows = [];
        const schemaFilter = schema ? String(schema) : "";
        for (const schemaRow of schemas) {
            const schemaName = String(schemaRow.name || "main");
            if (schemaFilter && schemaName !== schemaFilter)
                continue;
            const tables = await db.all(`SELECT name FROM ${quoteIdentifier(schemaName)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
            for (const tableRow of tables) {
                const tableName = String(tableRow.name);
                const tableInfo = await db.all(`PRAGMA ${quoteIdentifier(schemaName)}.table_info(${quoteIdentifier(tableName)});`);
                const foreignKeys = await db.all(`PRAGMA ${quoteIdentifier(schemaName)}.foreign_key_list(${quoteIdentifier(tableName)});`);
                const fkMap = new Map();
                for (const fk of foreignKeys) {
                    if (!fkMap.has(fk.from))
                        fkMap.set(fk.from, fk);
                }
                for (const column of tableInfo) {
                    const fk = fkMap.get(column.name);
                    rows.push({
                        table_schema: schemaName,
                        table_name: tableName,
                        column_name: column.name,
                        data_type: column.type || "TEXT",
                        is_nullable: column.notnull ? "NO" : "YES",
                        column_default: column.dflt_value,
                        is_primary: Number(column.pk || 0) > 0,
                        referenced_table_schema: fk ? schemaName : null,
                        referenced_table_name: fk?.table ?? null,
                        referenced_column_name: fk?.to ?? null,
                    });
                }
            }
        }
        return rows;
    });
}
