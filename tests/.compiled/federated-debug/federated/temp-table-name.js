"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFederatedTempTableName = getFederatedTempTableName;
function getFederatedTempTableName(alias, table) {
    const base = `${alias}__${table}`.replace(/[^a-zA-Z0-9_]/g, "_");
    return `federated_${base}`;
}
