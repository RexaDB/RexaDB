"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withFederatedTempDb = withFederatedTempDb;
exports.createFederatedTempTable = createFederatedTempTable;
exports.insertFederatedTempRow = insertFederatedTempRow;
const node_1 = require("@libsql/client/node");
const quote_1 = require("./quote");
async function withFederatedTempDb(run) {
    const client = (0, node_1.createClient)({ url: "file::memory:" });
    try {
        return await run(client);
    }
    finally {
        await client.close?.();
    }
}
async function createFederatedTempTable(client, tableName, columns) {
    const defs = columns.map((column) => `${(0, quote_1.quoteFederatedIdent)(column.name)} ${column.type}`).join(", ");
    await client.execute(`CREATE TABLE ${(0, quote_1.quoteFederatedIdent)(tableName)} (${defs})`);
}
async function insertFederatedTempRow(client, tableName, row) {
    const names = Object.keys(row);
    const placeholders = names.map(() => "?").join(", ");
    const sql = `INSERT INTO ${(0, quote_1.quoteFederatedIdent)(tableName)} (${names.map(quote_1.quoteFederatedIdent).join(", ")}) VALUES (${placeholders})`;
    await client.execute({ sql, args: names.map((name) => row[name]) });
}
