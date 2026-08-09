"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewriteFederatedTableRef = rewriteFederatedTableRef;
const temp_table_name_1 = require("./temp-table-name");
function rewriteFederatedTableRef(table, refs) {
    if (table?.type !== "table")
        return;
    const alias = String(table?.name?.schema || "");
    const tableName = String(table?.name?.name || "");
    const ref = refs.find((entry) => entry.alias === alias && entry.table === tableName);
    if (!ref)
        return;
    table.name = {
        name: (0, temp_table_name_1.getFederatedTempTableName)(ref.alias, ref.table),
        alias: table?.name?.alias,
    };
}
