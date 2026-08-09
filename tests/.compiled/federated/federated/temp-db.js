"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withFederatedTempDb = withFederatedTempDb;
exports.createFederatedTempTable = createFederatedTempTable;
exports.insertFederatedTempRow = insertFederatedTempRow;
const quote_1 = require("./quote");
async function createBetterSqliteClient() {
    const mod = await import("better-sqlite3");
    const BetterSqlite3 = (mod.default ?? mod);
    const db = new BetterSqlite3(":memory:");
    db.pragma("foreign_keys = ON");
    return {
        execute: async ({ sql, args }) => {
            const stmt = db.prepare(sql);
            if (stmt.reader) {
                const rows = args && args.length > 0 ? stmt.all(args) : stmt.all();
                return { rows, rowsAffected: rows.length };
            }
            const info = args && args.length > 0 ? stmt.run(args) : stmt.run();
            return { rows: [], rowsAffected: Number(info.changes || 0) };
        },
        close: () => {
            db.close();
        },
    };
}
async function createLibsqlClient() {
    const { createClient } = await import("@libsql/client/node");
    const client = createClient({ url: "file::memory:" });
    return {
        execute: async (input) => client.execute(input),
        close: async () => {
            try {
                await client.close?.();
            }
            catch { }
        },
    };
}
async function createFederatedTempClient() {
    try {
        return await createBetterSqliteClient();
    }
    catch (error) {
        console.warn("Federated temp DB fallback to libsql client:", error);
        return await createLibsqlClient();
    }
}
async function withFederatedTempDb(run) {
    const client = await createFederatedTempClient();
    try {
        return await run(client);
    }
    finally {
        await client.close?.();
    }
}
async function createFederatedTempTable(client, tableName, columns) {
    const defs = columns.map((column) => `${(0, quote_1.quoteFederatedIdent)(column.name)} ${column.type}`).join(", ");
    await client.execute({ sql: `CREATE TABLE ${(0, quote_1.quoteFederatedIdent)(tableName)} (${defs})` });
}
async function insertFederatedTempRow(client, tableName, row) {
    const names = Object.keys(row);
    const placeholders = names.map(() => "?").join(", ");
    const sql = `INSERT INTO ${(0, quote_1.quoteFederatedIdent)(tableName)} (${names.map(quote_1.quoteFederatedIdent).join(", ")}) VALUES (${placeholders})`;
    await client.execute({ sql, args: names.map((name) => row[name]) });
}
