"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeQuery = executeQuery;
exports.cancelQueryById = cancelQueryById;
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
let Client;
let Pool;
try {
    const pg = require("pg");
    Client = pg.Client;
    Pool = pg.Pool;
}
catch { }
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const runningPgQueries = new Map();
const pgPoolEntries = new Map();
function normalizePgConnectionString(connectionString) {
    const input = String(connectionString || "").trim();
    if (/^postgres(?:ql)?:\/(?!\/)/i.test(input)) {
        return input.replace(/^((?:postgres(?:ql)?):)\/(?!\/)/i, "$1//");
    }
    return input;
}
function parsePgConfig(connectionString) {
    const fallback = {
        host: "localhost",
        port: 5432,
        database: "",
        username: "",
        password: "",
        sslMode: "disable",
    };
    try {
        const parsed = new URL(normalizePgConnectionString(connectionString));
        let host = parsed.hostname || "localhost";
        let port = Number(parsed.port || "5432");
        if (!Number.isFinite(port) || port <= 0)
            port = 5432;
        // Check search params first for dbname, then fallback to pathname
        let database = decodePgCredential(parsed.searchParams.get("dbname") ||
            parsed.searchParams.get("database") ||
            String(parsed.pathname || "").replace(/^\/+/, ""));
        let username = decodePgCredential(parsed.username || "");
        let password = decodePgCredential(parsed.password || "");
        const rawSslMode = String(parsed.searchParams.get("sslmode") || "disable").toLowerCase();
        const sslMode = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(rawSslMode)
            ? rawSslMode
            : "disable";
        if (password === "" &&
            database &&
            /^([^:/]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/.test(database)) {
            const m = database.match(/^([^:/]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/);
            if (m) {
                username = decodePgCredential(m[1] || "");
                password = decodePgCredential(m[2] || "");
                host = m[3] || host;
                const recoveredPort = Number(m[4] || "5432");
                port = Number.isFinite(recoveredPort) && recoveredPort > 0 ? recoveredPort : port;
                database = decodePgCredential(m[5] || "");
            }
        }
        // Final override from search params if they exist (even if password is NOT empty)
        const searchDbName = parsed.searchParams.get("dbname") || parsed.searchParams.get("database");
        if (searchDbName) {
            database = decodePgCredential(searchDbName);
        }
        return { host, port, database, username, password, sslMode };
    }
    catch {
        return fallback;
    }
}
function decodePgCredential(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function getPgPassword(connectionString) {
    return parsePgConfig(connectionString).password;
}
function getPgUsername(connectionString) {
    return parsePgConfig(connectionString).username;
}
function getPgDatabase(connectionString) {
    return parsePgConfig(connectionString).database;
}
function getPgHost(connectionString) {
    return parsePgConfig(connectionString).host;
}
function getPgPort(connectionString) {
    return parsePgConfig(connectionString).port;
}
function getPgSslConfig(connectionString) {
    const sslMode = parsePgConfig(connectionString).sslMode;
    return sslMode === "disable" ? false : { rejectUnauthorized: false };
}
function parseExtendedConnection(connectionString) {
    const url = new URL(normalizePgConnectionString(connectionString));
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
    const url = new URL(normalizePgConnectionString(connectionString));
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
    const targetPort = Number(target.port || "5432");
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
async function getPgPoolEntry(connectionString) {
    const config = parsePgConfig(connectionString);
    const cacheKey = `${config.host}:${config.port}:${config.database}:${config.username}`;
    const cached = pgPoolEntries.get(cacheKey);
    if (cached)
        return await cached;
    const pending = (async () => {
        const tunnel = await startSshTunnelIfNeeded(connectionString);
        const effectiveConnectionString = tunnel.connectionString;
        const pool = new Pool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.username,
            password: config.password,
            connectionTimeoutMillis: 15000,
            idleTimeoutMillis: 30000,
            max: 6,
            ssl: getPgSslConfig(effectiveConnectionString),
        });
        pool.on("error", (error) => {
            console.error("PostgreSQL pool error:", error.message);
        });
        return {
            pool,
            effectiveConnectionString,
            tunnel,
        };
    })();
    pgPoolEntries.set(cacheKey, pending);
    try {
        return await pending;
    }
    catch (error) {
        pgPoolEntries.delete(cacheKey);
        throw error;
    }
}
function quotePgIdentifier(value) {
    return `"${String(value || "").replace(/"/g, '""')}"`;
}
async function applyExecutionContext(client, context) {
    if (context.kind === "role") {
        await client.query(`SET LOCAL ROLE ${quotePgIdentifier(context.role)}`);
        return;
    }
    await client.query(`SET LOCAL ROLE ${quotePgIdentifier(context.role)}`);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [context.userId]);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', $1, true)", [context.role]);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claims', $1, true)", [JSON.stringify(context.claims)]);
    if (context.email) {
        await client.query("SELECT pg_catalog.set_config('request.jwt.claim.email', $1, true)", [context.email]);
    }
    if (context.phone) {
        await client.query("SELECT pg_catalog.set_config('request.jwt.claim.phone', $1, true)", [context.phone]);
    }
}
async function executeQuery(connectionString, query, params = [], options = {}) {
    const { pool, effectiveConnectionString } = await getPgPoolEntry(connectionString);
    const queryId = options.queryId?.trim();
    const executionContext = options.executionContext ?? null;
    let client = null;
    let scopedTransactionStarted = false;
    try {
        client = await pool.connect();
        const backendPid = Number(client.processID);
        if (queryId && Number.isFinite(backendPid) && backendPid > 0) {
            runningPgQueries.set(queryId, {
                pid: backendPid,
                effectiveConnectionString,
            });
        }
        if (executionContext) {
            await client.query("BEGIN");
            scopedTransactionStarted = true;
            await applyExecutionContext(client, executionContext);
        }
        const rawRes = await client.query(query, params);
        // In simple-query mode, pg may return an array for multi-statement SQL.
        const res = Array.isArray(rawRes)
            ? (rawRes[rawRes.length - 1] ?? { rows: [], fields: [], rowCount: 0 })
            : rawRes;
        // Fetch type names for the fields if they exist
        let fields = [];
        if (Array.isArray(res.fields) && res.fields.length > 0) {
            const typeOids = Array.from(new Set(res.fields.map((f) => f.dataTypeID)));
            const typeRes = await client.query('SELECT oid, typname FROM pg_type WHERE oid = ANY($1)', [typeOids]);
            const typeMap = Object.fromEntries(typeRes.rows.map(r => [r.oid, r.typname]));
            fields = res.fields.map((f) => ({
                name: f.name,
                dataTypeID: f.dataTypeID,
                dataTypeName: typeMap[f.dataTypeID] || 'unknown'
            }));
        }
        // Serialize rows to handle non-plain objects (BigInt, Interval, Buffer, etc.)
        const serializedRows = Array.isArray(res.rows)
            ? res.rows.map((row) => serializeRow(row))
            : [];
        if (scopedTransactionStarted) {
            await client.query("COMMIT");
            scopedTransactionStarted = false;
        }
        return {
            rows: serializedRows,
            fields,
            rowCount: res.rowCount ?? 0,
        };
    }
    catch (error) {
        if (client && scopedTransactionStarted) {
            try {
                await client.query("ROLLBACK");
            }
            catch (rollbackError) {
                console.error("Failed to rollback PostgreSQL permission context:", rollbackError);
            }
        }
        console.error(`PostgreSQL Error [${error.code}]:`, error.message);
        throw error;
    }
    finally {
        if (queryId) {
            runningPgQueries.delete(queryId);
        }
        client?.release();
    }
}
async function cancelQueryById(queryId) {
    const normalizedQueryId = String(queryId || "").trim();
    if (!normalizedQueryId)
        return false;
    const running = runningPgQueries.get(normalizedQueryId);
    if (!running)
        return false;
    const cancelClient = new Client({
        host: getPgHost(running.effectiveConnectionString),
        port: getPgPort(running.effectiveConnectionString),
        database: getPgDatabase(running.effectiveConnectionString),
        user: getPgUsername(running.effectiveConnectionString),
        password: getPgPassword(running.effectiveConnectionString),
        connectionTimeoutMillis: 8000,
        ssl: getPgSslConfig(running.effectiveConnectionString),
    });
    try {
        await cancelClient.connect();
        const res = await cancelClient.query("SELECT pg_cancel_backend($1) AS cancelled", [running.pid]);
        return Boolean(res.rows?.[0]?.cancelled);
    }
    catch (error) {
        console.error("Failed to cancel PostgreSQL query:", error?.message || error);
        return false;
    }
    finally {
        try {
            await cancelClient.end();
        }
        catch { }
    }
}
async function getTables(connectionString, schema) {
    const query = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = $1
    ORDER BY table_name;
  `;
    const result = await executeQuery(connectionString, query, [schema]);
    return result.rows.map((r) => r.table_name);
}
async function getViews(connectionString, schema) {
    const query = `
    SELECT table_name AS name
    FROM information_schema.views
    WHERE table_schema = $1
    UNION
    SELECT matviewname AS name
    FROM pg_matviews
    WHERE schemaname = $1
    ORDER BY name;
  `;
    const result = await executeQuery(connectionString, query, [schema]);
    return result.rows.map((r) => r.name);
}
async function getSchemas(connectionString) {
    const query = `
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
    AND schema_name NOT LIKE 'pg_toast%'
    ORDER BY schema_name;
  `;
    const result = await executeQuery(connectionString, query);
    return result.rows.map((r) => r.schema_name);
}
async function getDatabases(connectionString) {
    const query = `
    SELECT datname as name
    FROM pg_database
    WHERE datistemplate = false
    ORDER BY datname;
  `;
    const result = await executeQuery(connectionString, query);
    return result.rows.map((r) => r.name);
}
async function getTableStructure(connectionString, schema, table) {
    const query = `
    SELECT 
      c.column_name, 
      c.data_type, 
      c.udt_schema,
      c.udt_name,
      c.is_nullable, 
      c.column_default,
      c.character_maximum_length,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = c.table_schema 
          AND tc.table_name = c.table_name 
          AND kcu.column_name = c.column_name
          AND tc.constraint_type = 'PRIMARY KEY'
      ) as is_primary_key,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = c.table_schema 
          AND tc.table_name = c.table_name 
          AND kcu.column_name = c.column_name
          AND tc.constraint_type = 'FOREIGN KEY'
      ) as is_foreign_key
    FROM information_schema.columns c
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position;
  `;
    const result = await executeQuery(connectionString, query, [schema, table]);
    return result.rows;
}
async function getTablePrimaryKey(connectionString, schema, table) {
    const query = `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2;
  `;
    const result = await executeQuery(connectionString, query, [schema, table]);
    return result.rows[0]?.column_name || null;
}
async function getTablePrimaryKeys(connectionString, schema, table) {
    const query = `
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2;
  `;
    const result = await executeQuery(connectionString, query, [schema, table]);
    return result.rows.map((r) => r.column_name);
}
async function getTableForeignKeys(connectionString, schema, table) {
    const query = `
    SELECT
      src_att.attname AS column_name,
      tgt_ns.nspname AS foreign_table_schema,
      tgt_tbl.relname AS foreign_table_name,
      tgt_att.attname AS foreign_column_name
    FROM pg_constraint con
    JOIN pg_class src_tbl
      ON src_tbl.oid = con.conrelid
    JOIN pg_namespace src_ns
      ON src_ns.oid = src_tbl.relnamespace
    JOIN pg_class tgt_tbl
      ON tgt_tbl.oid = con.confrelid
    JOIN pg_namespace tgt_ns
      ON tgt_ns.oid = tgt_tbl.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_col(attnum, ord)
      ON true
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS tgt_col(attnum, ord)
      ON tgt_col.ord = src_col.ord
    JOIN pg_attribute src_att
      ON src_att.attrelid = src_tbl.oid
      AND src_att.attnum = src_col.attnum
    JOIN pg_attribute tgt_att
      ON tgt_att.attrelid = tgt_tbl.oid
      AND tgt_att.attnum = tgt_col.attnum
    WHERE con.contype = 'f'
      AND src_ns.nspname = $1
      AND src_tbl.relname = $2
    ORDER BY con.conname, src_col.ord;
  `;
    try {
        const result = await executeQuery(connectionString, query, [schema, table]);
        return result.rows;
    }
    catch (err) {
        console.error("Error fetching foreign keys:", err);
        return [];
    }
}
async function deleteRows(connectionString, schema, table, pkColumn, pkValues) {
    const placeholders = pkValues.map((_, i) => `$${i + 1}`).join(', ');
    const query = `DELETE FROM "${schema}"."${table}" WHERE "${pkColumn}" IN (${placeholders})`;
    return await executeQuery(connectionString, query, pkValues);
}
async function updateRows(connectionString, schema, table, updates) {
    const tunnel = await startSshTunnelIfNeeded(connectionString);
    const effectiveConnectionString = tunnel.connectionString;
    const client = new Client({
        host: getPgHost(effectiveConnectionString),
        port: getPgPort(effectiveConnectionString),
        database: getPgDatabase(effectiveConnectionString),
        user: getPgUsername(effectiveConnectionString),
        password: getPgPassword(effectiveConnectionString),
        ssl: getPgSslConfig(effectiveConnectionString),
    });
    try {
        await client.connect();
        await client.query('BEGIN');
        for (const update of updates) {
            const setClauses = [];
            const setValues = [];
            let paramIndex = 1;
            for (const [col, val] of Object.entries(update.set)) {
                setClauses.push(`"${col}" = $${paramIndex++}`);
                setValues.push(val);
            }
            const whereClauses = [];
            for (const [col, val] of Object.entries(update.where)) {
                whereClauses.push(`"${col}" = $${paramIndex++}`);
                setValues.push(val);
            }
            const query = `UPDATE "${schema}"."${table}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
            await client.query(query, setValues);
        }
        await client.query('COMMIT');
        return { success: true };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        try {
            await client.end();
        }
        catch (e) { }
        try {
            await tunnel.close();
        }
        catch { }
    }
}
function serializeRow(row) {
    if (!row)
        return row;
    const serialized = {};
    for (const [key, value] of Object.entries(row)) {
        serialized[key] = serializeValue(value);
    }
    return serialized;
}
function serializeValue(value) {
    if (value === null || value === undefined) {
        return value;
    }
    // Handle BigInt
    if (typeof value === "bigint") {
        return value.toString();
    }
    // Handle Date
    if (value instanceof Date) {
        return value.toISOString();
    }
    // Handle Buffer (BYTEA)
    if (Buffer.isBuffer(value)) {
        return value.toString("hex");
    }
    // Handle Arrays
    if (Array.isArray(value)) {
        return value.map(serializeValue);
    }
    // Handle Objects (Interval, JSONB, etc.)
    if (typeof value === "object") {
        // If it's a plain object, we still want to recursively serialize its values
        // If it's a class instance (like PostgresInterval), this will convert it to a plain object
        const serializedObj = {};
        for (const [key, val] of Object.entries(value)) {
            serializedObj[key] = serializeValue(val);
        }
        return serializedObj;
    }
    return value;
}
