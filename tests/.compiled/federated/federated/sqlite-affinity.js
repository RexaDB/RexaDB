"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFederatedSqliteType = toFederatedSqliteType;
function toFederatedSqliteType(dataType) {
    const raw = String(dataType || "").toLowerCase();
    if (/int|serial|bigint|smallint/.test(raw))
        return "INTEGER";
    if (/real|double|float|numeric|decimal/.test(raw))
        return "REAL";
    if (/blob|binary|bytea/.test(raw))
        return "BLOB";
    return "TEXT";
}
