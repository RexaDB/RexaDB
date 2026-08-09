"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSqlEngineReferencedRecord = getSqlEngineReferencedRecord;
const detect_1 = require("./detect");
async function getSqlEngineReferencedRecord(connectionString, schema, table, keyValues) {
    const engine = (0, detect_1.getSqlEngineKind)(connectionString);
    if (engine === "sqlite") {
        return (await import("../sqlite-client")).getSqliteReferencedRecord(connectionString, schema, table, keyValues);
    }
    if (engine === "mysql") {
        return (await import("../mysql-referenced-record")).getMysqlReferencedRecord(connectionString, schema, table, keyValues);
    }
    if (engine === "postgres") {
        const { executeQuery } = await import("../pg-client");
        const entries = Object.entries(keyValues || {}).filter(([key]) => key);
        if (entries.length === 0) {
            return { row: null, fields: [] };
        }
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        for (const [key, val] of entries) {
            if (val === null) {
                conditions.push(`"${key}" IS NULL`);
            }
            else {
                conditions.push(`"${key}" = $${paramIndex}`);
                values.push(val);
                paramIndex += 1;
            }
        }
        const query = `SELECT * FROM "${schema}"."${table}" WHERE ${conditions.join(" AND ")} LIMIT 1`;
        const result = await executeQuery(connectionString, query, values);
        return { row: result.rows[0] ?? null, fields: result.fields };
    }
    throw new Error("Unsupported SQL engine.");
}
