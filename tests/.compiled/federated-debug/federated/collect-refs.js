"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectFederatedRefs = collectFederatedRefs;
const temp_table_name_1 = require("./temp-table-name");
function pushRef(into, schema, table, namespace) {
    if (!schema || !table)
        return;
    if (into.some((entry) => entry.alias === schema && entry.table === table))
        return;
    into.push({ alias: schema, table, namespace, tempTable: (0, temp_table_name_1.getFederatedTempTableName)(schema, table) });
}
function walk(statement, namespaces, refs) {
    if (!statement || typeof statement !== "object")
        return;
    if (Array.isArray(statement?.from)) {
        for (const entry of statement.from) {
            if (entry?.type === "table") {
                pushRef(refs, String(entry?.name?.schema || ""), String(entry?.name?.name || ""), namespaces[String(entry?.name?.schema || "")] || "");
            }
            if (entry?.type === "statement")
                walk(entry.statement, namespaces, refs);
        }
    }
    if (statement?.type === "with") {
        for (const binding of statement.bind || [])
            walk(binding?.statement, namespaces, refs);
        walk(statement.in, namespaces, refs);
    }
}
function collectFederatedRefs(statement, namespaces) {
    const refs = [];
    walk(statement, namespaces, refs);
    return refs;
}
