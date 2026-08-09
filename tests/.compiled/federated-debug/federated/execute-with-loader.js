"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeFederatedQueryWithLoader = executeFederatedQueryWithLoader;
const postgres_compat_1 = require("../postgres-compat");
const ast_1 = require("../postgres-compat/ast");
const normalize_1 = require("../postgres-compat/normalize");
const collect_refs_1 = require("./collect-refs");
const result_fields_1 = require("./result-fields");
const rewrite_query_1 = require("./rewrite-query");
const sqlite_affinity_1 = require("./sqlite-affinity");
const temp_db_1 = require("./temp-db");
async function executeFederatedQueryWithLoader(query, params, namespaces, loadTable) {
    const normalized = (0, normalize_1.normalizePgSyntax)(query);
    const statement = (0, ast_1.parsePostgresStatement)(normalized);
    if (!["select", "with"].includes(String(statement?.type || ""))) {
        throw new Error("Federated queries currently support SELECT and WITH statements only.");
    }
    const refs = (0, collect_refs_1.collectFederatedRefs)(statement, namespaces);
    const loaded = await Promise.all(refs.map(async (ref) => ({
        ref,
        data: await loadTable(ref.alias, ref.table, ref.namespace),
    })));
    const rewritten = (0, rewrite_query_1.rewriteFederatedQuery)(normalized, refs);
    const compiled = (0, postgres_compat_1.compilePostgresQuery)(rewritten, params, "sqlite");
    return await (0, temp_db_1.withFederatedTempDb)(async (client) => {
        for (const entry of loaded) {
            await (0, temp_db_1.createFederatedTempTable)(client, entry.ref.tempTable, entry.data.columns.map((column) => ({ name: column.name, type: (0, sqlite_affinity_1.toFederatedSqliteType)(column.dataType) })));
            for (const row of entry.data.rows) {
                await (0, temp_db_1.insertFederatedTempRow)(client, entry.ref.tempTable, row);
            }
        }
        const result = await client.execute({ sql: compiled.query, args: compiled.params });
        const rows = result.rows || [];
        return { rows, fields: (0, result_fields_1.buildFederatedFields)(rows), rowCount: rows.length };
    });
}
