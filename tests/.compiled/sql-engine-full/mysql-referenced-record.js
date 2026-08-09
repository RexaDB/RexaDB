"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMysqlReferencedRecord = getMysqlReferencedRecord;
const mysql_client_1 = require("./mysql-client");
function quoteMysqlIdentifier(value) {
    return `\`${String(value || "").replace(/`/g, "``")}\``;
}
async function getMysqlReferencedRecord(connectionString, schema, table, keyValues) {
    const entries = Object.entries(keyValues || {}).filter(([key]) => key);
    if (entries.length === 0) {
        return { row: null, fields: [] };
    }
    const conditions = [];
    const values = [];
    for (const [key, val] of entries) {
        if (val === null) {
            conditions.push(`${quoteMysqlIdentifier(key)} IS NULL`);
        }
        else {
            conditions.push(`${quoteMysqlIdentifier(key)} = ?`);
            values.push(val);
        }
    }
    const sql = `
    SELECT *
    FROM ${quoteMysqlIdentifier(schema)}.${quoteMysqlIdentifier(table)}
    WHERE ${conditions.join(" AND ")}
    LIMIT 1
  `;
    const result = await (0, mysql_client_1.executeMysqlQuery)(connectionString, sql, values);
    return { row: result.rows[0] ?? null, fields: result.fields };
}
