"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeMysqlQuery = executeMysqlQuery;
exports.getTables = getTables;
exports.getViews = getViews;
exports.getSchemas = getSchemas;
exports.getDatabases = getDatabases;
exports.getTableStructure = getTableStructure;
exports.getTablePrimaryKey = getTablePrimaryKey;
exports.getTablePrimaryKeys = getTablePrimaryKeys;
exports.getTableForeignKeys = getTableForeignKeys;
exports.deleteRows = deleteRows;
exports.updateRows = updateRows;
exports.getAllTablesWithColumns = getAllTablesWithColumns;
exports.isMysqlConnectionString = isMysqlConnectionString;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
let MYSQL_TYPE_NAMES;
try {
    const Types = require("mysql2").Types;
    MYSQL_TYPE_NAMES = Object.fromEntries(Object.entries(Types)
        .filter((entry) => typeof entry[1] === "number")
        .map(([key, value]) => [value, key.toLowerCase()]));
}
catch {
    MYSQL_TYPE_NAMES = {};
}
function normalizeMysqlConnectionString(connectionString) {
    const input = String(connectionString || "").trim();
    if (/^(mysql|mariadb):\/(?!\/)/i.test(input)) {
        return input.replace(/^((?:mysql|mariadb):)\/(?!\/)/i, "$1//");
    }
    if (!/^(mysql|mariadb):\/\//i.test(input) && !input.includes("://") && input.length > 0) {
        return `mysql://${input}`;
    }
    return input;
}
function decodeMysqlCredential(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function parseMysqlConfig(connectionString) {
    const fallback = {
        host: "localhost",
        port: 3306,
        database: "",
        username: "",
        password: "",
        sslMode: "disable",
    };
    try {
        const parsed = new URL(normalizeMysqlConnectionString(connectionString));
        const protocol = String(parsed.protocol || "").toLowerCase();
        if (!protocol.startsWith("mysql") && !protocol.startsWith("mariadb")) {
            return fallback;
        }
        const host = parsed.hostname || "localhost";
        let port = Number(parsed.port || "3306");
        if (!Number.isFinite(port) || port <= 0)
            port = 3306;
        const database = decodeMysqlCredential(String(parsed.pathname || "").replace(/^\/+/, ""));
        const username = decodeMysqlCredential(parsed.username || "");
        const password = decodeMysqlCredential(parsed.password || "");
        const rawSslMode = String(parsed.searchParams.get("sslmode") || parsed.searchParams.get("ssl") || "").toLowerCase();
        const sslMode = rawSslMode && !["disable", "false", "0", "off"].includes(rawSslMode)
            ? "require"
            : "disable";
        return { host, port, database, username, password, sslMode };
    }
    catch {
        return fallback;
    }
}
function getMysqlHost(connectionString) {
    return parseMysqlConfig(connectionString).host;
}
function getMysqlPort(connectionString) {
    return parseMysqlConfig(connectionString).port;
}
function getMysqlDatabase(connectionString) {
    return parseMysqlConfig(connectionString).database;
}
function getMysqlUsername(connectionString) {
    return parseMysqlConfig(connectionString).username;
}
function getMysqlPassword(connectionString) {
    return parseMysqlConfig(connectionString).password;
}
function getMysqlSslConfig(connectionString) {
    const sslMode = parseMysqlConfig(connectionString).sslMode;
    return sslMode === "disable" ? undefined : { rejectUnauthorized: false };
}
function parseExtendedConnection(connectionString) {
    const url = new URL(normalizeMysqlConnectionString(connectionString));
    const sshMode = url.searchParams.get("rexadb_ssh_mode") === "ssh" ? "ssh" : "off";
    const sshConfig = {
        mode: sshMode,
        host: url.searchParams.get("rexadb_ssh_host") || "",
        port: Number(url.searchParams.get("rexadb_ssh_port") || "22") || 22,
        username: url.searchParams.get("rexadb_ssh_user") || "",
        authMode: url.searchParams.get("rexadb_ssh_auth") === "private-key" ? "private-key" : "password",
        password: url.searchParams.get("rexadb_ssh_password") || "",
        privateKey: url.searchParams.get("rexadb_ssh_private_key") || "",
    };
    const customKeys = [
        "rexadb_keychain_db",
        "rexadb_ssh_mode",
        "rexadb_ssh_host",
        "rexadb_ssh_port",
        "rexadb_ssh_user",
        "rexadb_ssh_auth",
        "rexadb_ssh_keychain",
        "rexadb_ssh_password",
        "rexadb_ssh_private_key",
    ];
    for (const key of customKeys) {
        url.searchParams.delete(key);
    }
    return {
        baseConnectionString: url.toString(),
        sshConfig,
    };
}
function withHostPort(connectionString, host, port) {
    const url = new URL(normalizeMysqlConnectionString(connectionString));
    url.hostname = host;
    url.port = String(port);
    return url.toString();
}
async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const server = net_1.default.createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = address && typeof address === "object" ? address.port : null;
            server.close(() => {
                if (!port)
                    reject(new Error("Unable to allocate local tunnel port."));
                else
                    resolve(port);
            });
        });
    });
}
async function startSshTunnelIfNeeded(connectionString) {
    const parsed = parseExtendedConnection(connectionString);
    if (parsed.sshConfig.mode !== "ssh") {
        return {
            connectionString: parsed.baseConnectionString,
            close: async () => { },
        };
    }
    const target = new URL(parsed.baseConnectionString);
    const targetHost = target.hostname;
    const targetPort = Number(target.port || "3306") || 3306;
    if (!parsed.sshConfig.host || !parsed.sshConfig.username) {
        throw new Error("SSH host and username are required when SSH tunnel is enabled.");
    }
    const localPort = await getFreePort();
    const tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), "rexadb-ssh-"));
    const cleanupPaths = [];
    const args = [
        "-N",
        "-L",
        `${localPort}:${targetHost}:${targetPort}`,
        "-p",
        String(parsed.sshConfig.port),
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        `${parsed.sshConfig.username}@${parsed.sshConfig.host}`,
    ];
    const env = { ...process.env };
    if (parsed.sshConfig.authMode === "private-key") {
        if (!parsed.sshConfig.privateKey.trim()) {
            throw new Error("SSH private key is required for private-key authentication.");
        }
        const keyPath = path_1.default.join(tmpDir, "id_key");
        fs_1.default.writeFileSync(keyPath, parsed.sshConfig.privateKey, { mode: 0o600 });
        cleanupPaths.push(keyPath);
        args.unshift("-i", keyPath);
    }
    else {
        if (!parsed.sshConfig.password) {
            throw new Error("SSH password is required for password authentication.");
        }
        const askPassPath = path_1.default.join(tmpDir, "askpass.sh");
        fs_1.default.writeFileSync(askPassPath, "#!/bin/sh\nprintf %s \"$REXADB_SSH_PASSWORD\"\n", { mode: 0o700 });
        cleanupPaths.push(askPassPath);
        env.SSH_ASKPASS = askPassPath;
        env.SSH_ASKPASS_REQUIRE = "force";
        env.DISPLAY = env.DISPLAY || ":0";
        env.REXADB_SSH_PASSWORD = parsed.sshConfig.password;
    }
    const proc = (0, child_process_1.spawn)("ssh", args, {
        stdio: ["ignore", "ignore", "pipe"],
        env,
    });
    await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            resolve();
        }, 1400);
        const fail = (msg) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error(msg));
        };
        proc.once("exit", (code, signal) => {
            fail(`SSH tunnel failed to start (${String(code ?? signal ?? "unknown")}).`);
        });
        proc.stderr.on("data", (chunk) => {
            const msg = String(chunk || "").trim();
            if (!msg)
                return;
            if (/permission denied|could not resolve hostname|connection refused|host key verification failed|no such identity|operation timed out/i.test(msg)) {
                fail(`SSH: ${msg}`);
            }
        });
    });
    return {
        connectionString: withHostPort(parsed.baseConnectionString, "127.0.0.1", localPort),
        close: async () => {
            try {
                proc.kill("SIGTERM");
            }
            catch { }
            for (const p of cleanupPaths) {
                try {
                    fs_1.default.unlinkSync(p);
                }
                catch { }
            }
            try {
                fs_1.default.rmdirSync(tmpDir);
            }
            catch { }
        },
    };
}
function quoteIdentifier(value) {
    return `\`${String(value || "").replace(/`/g, "``")}\``;
}
function serializeValue(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === "bigint")
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (Buffer.isBuffer(value))
        return value.toString("hex");
    if (Array.isArray(value))
        return value.map((v) => serializeValue(v));
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = serializeValue(v);
        return out;
    }
    return value;
}
function serializeRows(rows = []) {
    return rows.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row))
            out[k] = serializeValue(v);
        return out;
    });
}
function buildFields(fields = []) {
    return fields.filter(Boolean).map((field) => {
        const typeId = field?.columnType ?? field?.type ?? 0;
        return {
            name: field?.name ?? "",
            dataTypeID: Number(typeId) || 0,
            dataTypeName: MYSQL_TYPE_NAMES[Number(typeId)] || "unknown",
        };
    }).filter((field) => field.name);
}
function isOkPacket(value) {
    return Boolean(value && typeof value === "object" && "affectedRows" in value);
}
function normalizeMysqlResult(rows, fields) {
    if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])) {
        const lastIndex = rows.length - 1;
        const lastRows = Array.isArray(rows[lastIndex]) ? rows[lastIndex] : [];
        const lastFields = Array.isArray(fields?.[lastIndex]) ? fields[lastIndex] : [];
        const rowCount = isOkPacket(lastRows) ? Number(lastRows.affectedRows || 0) : (Array.isArray(lastRows) ? lastRows.length : 0);
        const normalizedRows = Array.isArray(lastRows) ? serializeRows(lastRows) : [];
        let normalizedFields = buildFields(lastFields);
        if (normalizedFields.length === 0 && normalizedRows.length > 0) {
            const keys = Object.keys(normalizedRows[0] || {}).filter((k) => k && !/^\d+$/.test(k));
            normalizedFields = keys.map((name) => ({ name, dataTypeID: 0, dataTypeName: "unknown" }));
        }
        return {
            rows: normalizedRows,
            fields: normalizedFields,
            rowCount,
        };
    }
    if (isOkPacket(rows)) {
        return {
            rows: [],
            fields: [],
            rowCount: Number(rows.affectedRows || 0),
        };
    }
    const normalizedRows = Array.isArray(rows) ? serializeRows(rows) : [];
    let normalizedFields = buildFields(Array.isArray(fields) ? fields : []);
    if (normalizedFields.length === 0 && normalizedRows.length > 0) {
        const keys = Object.keys(normalizedRows[0] || {}).filter((k) => k && !/^\d+$/.test(k));
        normalizedFields = keys.map((name) => ({ name, dataTypeID: 0, dataTypeName: "unknown" }));
    }
    return {
        rows: normalizedRows,
        fields: normalizedFields,
        rowCount: Array.isArray(rows) ? rows.length : 0,
    };
}
async function executeMysqlQuery(connectionString, query, params = []) {
    const tunnel = await startSshTunnelIfNeeded(connectionString);
    const effectiveConnectionString = tunnel.connectionString;
    const { createConnection } = await import("mysql2/promise");
    const connection = await createConnection({
        host: getMysqlHost(effectiveConnectionString),
        port: getMysqlPort(effectiveConnectionString),
        database: getMysqlDatabase(effectiveConnectionString),
        user: getMysqlUsername(effectiveConnectionString),
        password: getMysqlPassword(effectiveConnectionString),
        connectTimeout: 15000,
        ssl: getMysqlSslConfig(effectiveConnectionString),
        multipleStatements: true,
    });
    try {
        const [rows, fields] = await connection.query({ sql: query, values: params });
        return normalizeMysqlResult(rows, fields);
    }
    finally {
        try {
            await connection.end();
        }
        catch { }
        try {
            await tunnel.close();
        }
        catch { }
    }
}
async function getTables(connectionString, schema) {
    const sql = `
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = ?
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
    const result = await executeMysqlQuery(connectionString, sql, [schema]);
    return result.rows.map((r) => String(r.name || r.table_name || r.TABLE_NAME || ""));
}
async function getViews(connectionString, schema) {
    const sql = `
    SELECT table_name AS name
    FROM information_schema.views
    WHERE table_schema = ?
    ORDER BY table_name;
  `;
    const result = await executeMysqlQuery(connectionString, sql, [schema]);
    return result.rows.map((r) => String(r.name || ""));
}
async function getSchemas(connectionString) {
    try {
        const showResult = await executeMysqlQuery(connectionString, "SHOW DATABASES;");
        const rows = showResult.rows || [];
        const names = rows.map((r) => String(r.Database || r.database || ""));
        const cleaned = names.map((name) => name.trim()).filter((name) => name.length > 0);
        if (cleaned.length > 0)
            return cleaned;
    }
    catch {
        // Fall back to information_schema.schemata below.
    }
    const sql = `
    SELECT schema_name
    FROM information_schema.schemata
    ORDER BY schema_name;
  `;
    const result = await executeMysqlQuery(connectionString, sql);
    return result.rows.map((r) => String(r.schema_name || ""));
}
async function getDatabases(connectionString) {
    return await getSchemas(connectionString);
}
async function getTableStructure(connectionString, schema, table) {
    const sql = `
    SELECT
      c.column_name,
      c.data_type,
      c.column_type,
      c.is_nullable,
      c.column_default,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.extra,
      CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
      CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END AS is_foreign_key
    FROM information_schema.columns c
    LEFT JOIN information_schema.key_column_usage pk
      ON c.table_schema = pk.table_schema
      AND c.table_name = pk.table_name
      AND c.column_name = pk.column_name
      AND pk.constraint_name = 'PRIMARY'
    LEFT JOIN information_schema.key_column_usage fk
      ON c.table_schema = fk.table_schema
      AND c.table_name = fk.table_name
      AND c.column_name = fk.column_name
      AND fk.referenced_table_name IS NOT NULL
    WHERE c.table_schema = ? AND c.table_name = ?
    ORDER BY c.ordinal_position;
  `;
    const result = await executeMysqlQuery(connectionString, sql, [schema, table]);
    return result.rows.map((row) => {
        const columnName = row.column_name ?? row.COLUMN_NAME ?? row.columnName ?? "";
        const dataType = row.data_type ?? row.DATA_TYPE ?? row.dataType ?? "";
        const columnType = row.column_type ?? row.COLUMN_TYPE ?? row.columnType ?? "";
        const isNullable = row.is_nullable ?? row.IS_NULLABLE ?? row.isNullable ?? "";
        const columnDefault = row.column_default ?? row.COLUMN_DEFAULT ?? row.columnDefault ?? null;
        const charMax = row.character_maximum_length ?? row.CHARACTER_MAXIMUM_LENGTH ?? row.characterMaximumLength ?? null;
        const numericPrecision = row.numeric_precision ?? row.NUMERIC_PRECISION ?? row.numericPrecision ?? null;
        const numericScale = row.numeric_scale ?? row.NUMERIC_SCALE ?? row.numericScale ?? null;
        const extra = row.extra ?? row.EXTRA ?? row.extra_info ?? row.extraInfo ?? "";
        const primaryRaw = row.is_primary_key ?? row.IS_PRIMARY_KEY ?? row.isPrimaryKey ?? false;
        const foreignRaw = row.is_foreign_key ?? row.IS_FOREIGN_KEY ?? row.isForeignKey ?? false;
        const isPrimary = typeof primaryRaw === "boolean"
            ? primaryRaw
            : Boolean(Number(primaryRaw)) || String(primaryRaw).toLowerCase() === "true";
        const isForeign = typeof foreignRaw === "boolean"
            ? foreignRaw
            : Boolean(Number(foreignRaw)) || String(foreignRaw).toLowerCase() === "true";
        return {
            column_name: String(columnName || ""),
            data_type: String(dataType || ""),
            column_type: String(columnType || ""),
            is_nullable: String(isNullable || ""),
            column_default: columnDefault,
            character_maximum_length: charMax,
            numeric_precision: numericPrecision,
            numeric_scale: numericScale,
            extra,
            is_primary_key: isPrimary,
            is_foreign_key: isForeign,
        };
    });
}
async function getTablePrimaryKey(connectionString, schema, table) {
    const sql = `
    SELECT column_name AS name
    FROM information_schema.key_column_usage
    WHERE table_schema = ?
      AND table_name = ?
      AND constraint_name = 'PRIMARY'
    ORDER BY ordinal_position;
  `;
    const result = await executeMysqlQuery(connectionString, sql, [schema, table]);
    const first = result.rows[0];
    return first?.name ?? first?.column_name ?? first?.COLUMN_NAME ?? null;
}
async function getTablePrimaryKeys(connectionString, schema, table) {
    const sql = `
    SELECT column_name AS name
    FROM information_schema.key_column_usage
    WHERE table_schema = ?
      AND table_name = ?
      AND constraint_name = 'PRIMARY'
    ORDER BY ordinal_position;
  `;
    const result = await executeMysqlQuery(connectionString, sql, [schema, table]);
    return result.rows.map((r) => r.name ?? r.column_name ?? r.COLUMN_NAME).filter(Boolean);
}
async function getTableForeignKeys(connectionString, schema, table) {
    const sql = `
    SELECT
      kcu.column_name AS column_name,
      kcu.referenced_table_schema AS foreign_table_schema,
      kcu.referenced_table_name AS foreign_table_name,
      kcu.referenced_column_name AS foreign_column_name
    FROM information_schema.key_column_usage kcu
    WHERE kcu.table_schema = ?
      AND kcu.table_name = ?
      AND kcu.referenced_table_name IS NOT NULL
    ORDER BY kcu.constraint_name, kcu.ordinal_position;
  `;
    const result = await executeMysqlQuery(connectionString, sql, [schema, table]);
    return result.rows;
}
async function deleteRows(connectionString, schema, table, pkColumn, pkValues) {
    if (!pkValues.length)
        return { rows: [], fields: [], rowCount: 0 };
    const placeholders = pkValues.map(() => "?").join(", ");
    const sql = `DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} WHERE ${quoteIdentifier(pkColumn)} IN (${placeholders})`;
    return await executeMysqlQuery(connectionString, sql, pkValues);
}
async function updateRows(connectionString, schema, table, updates) {
    const tunnel = await startSshTunnelIfNeeded(connectionString);
    const effectiveConnectionString = tunnel.connectionString;
    const { createConnection } = await import("mysql2/promise");
    const connection = await createConnection({
        host: getMysqlHost(effectiveConnectionString),
        port: getMysqlPort(effectiveConnectionString),
        database: getMysqlDatabase(effectiveConnectionString),
        user: getMysqlUsername(effectiveConnectionString),
        password: getMysqlPassword(effectiveConnectionString),
        connectTimeout: 15000,
        ssl: getMysqlSslConfig(effectiveConnectionString),
        multipleStatements: false,
    });
    try {
        await connection.beginTransaction();
        for (const update of updates) {
            const setClauses = [];
            const values = [];
            for (const [col, val] of Object.entries(update.set)) {
                setClauses.push(`${quoteIdentifier(col)} = ?`);
                values.push(val);
            }
            const whereClauses = [];
            for (const [col, val] of Object.entries(update.where)) {
                whereClauses.push(`${quoteIdentifier(col)} = ?`);
                values.push(val);
            }
            const sql = `UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
            await connection.execute(sql, values);
        }
        await connection.commit();
        return { success: true };
    }
    catch (error) {
        try {
            await connection.rollback();
        }
        catch { }
        throw error;
    }
    finally {
        try {
            await connection.end();
        }
        catch { }
        try {
            await tunnel.close();
        }
        catch { }
    }
}
async function getAllTablesWithColumns(connectionString, schema) {
    const schemaFilter = schema ? String(schema) : "";
    const sql = `
    SELECT
      cols.table_schema AS table_schema,
      cols.table_name AS table_name,
      cols.column_name AS column_name,
      cols.data_type AS data_type,
      cols.is_nullable AS is_nullable,
      cols.column_default AS column_default,
      (cols.column_key = 'PRI') AS is_primary,
      kcu.referenced_table_schema AS referenced_table_schema,
      kcu.referenced_table_name AS referenced_table_name,
      kcu.referenced_column_name AS referenced_column_name
    FROM information_schema.columns cols
    LEFT JOIN information_schema.key_column_usage kcu
      ON cols.table_schema = kcu.table_schema
      AND cols.table_name = kcu.table_name
      AND cols.column_name = kcu.column_name
      AND kcu.referenced_table_name IS NOT NULL
    WHERE cols.table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
    ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position;
  `;
    const res = schemaFilter
        ? await executeMysqlQuery(connectionString, `${sql.replace("WHERE cols.table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')", "WHERE cols.table_schema = ?")}`, [schemaFilter])
        : await executeMysqlQuery(connectionString, sql);
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    return rows.map((row) => {
        const tableSchema = row.table_schema ?? row.TABLE_SCHEMA ?? row.tableSchema ?? "";
        const tableName = row.table_name ?? row.TABLE_NAME ?? row.tableName ?? "";
        const columnName = row.column_name ?? row.COLUMN_NAME ?? row.columnName ?? "";
        const dataType = row.data_type ?? row.DATA_TYPE ?? row.dataType ?? "";
        const isNullable = row.is_nullable ?? row.IS_NULLABLE ?? row.isNullable ?? "";
        const columnDefault = row.column_default ?? row.COLUMN_DEFAULT ?? row.columnDefault ?? null;
        const isPrimaryRaw = row.is_primary ?? row.IS_PRIMARY ?? row.isPrimary ?? false;
        const refSchema = row.referenced_table_schema ?? row.REFERENCED_TABLE_SCHEMA ?? row.referencedTableSchema ?? null;
        const refTable = row.referenced_table_name ?? row.REFERENCED_TABLE_NAME ?? row.referencedTableName ?? null;
        const refColumn = row.referenced_column_name ?? row.REFERENCED_COLUMN_NAME ?? row.referencedColumnName ?? null;
        const isPrimary = typeof isPrimaryRaw === "boolean"
            ? isPrimaryRaw
            : Boolean(Number(isPrimaryRaw)) || String(isPrimaryRaw).toLowerCase() === "true";
        return {
            table_schema: String(tableSchema || ""),
            table_name: String(tableName || ""),
            column_name: String(columnName || ""),
            data_type: String(dataType || ""),
            is_nullable: String(isNullable || ""),
            column_default: columnDefault,
            is_primary: isPrimary,
            referenced_table_schema: refSchema,
            referenced_table_name: refTable,
            referenced_column_name: refColumn,
        };
    }).filter((row) => row.table_schema && row.table_name && row.column_name);
}
function isMysqlConnectionString(connectionString) {
    const raw = String(connectionString || "").trim().toLowerCase();
    return raw.startsWith("mysql://") || raw.startsWith("mariadb://") || raw.startsWith("mysql:/") || raw.startsWith("mariadb:/");
}
