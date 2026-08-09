"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFederatedFields = buildFederatedFields;
function buildFederatedFields(rows) {
    if (!rows.length)
        return [];
    return Object.keys(rows[0]).map((name) => ({
        name,
        dataTypeID: 0,
        dataTypeName: "unknown",
    }));
}
