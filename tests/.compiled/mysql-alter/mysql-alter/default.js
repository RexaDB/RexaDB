"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMysqlDefaultValue = renderMysqlDefaultValue;
function isMysqlExpressionDefault(value) {
    return /^current_timestamp(?:\(\))?$/i.test(value)
        || /^current_timestamp\s+on update\s+current_timestamp(?:\(\))?$/i.test(value);
}
function isNumericDefault(value) {
    return /^-?\d+(?:\.\d+)?$/.test(value);
}
function renderMysqlDefaultValue(value) {
    if (value === null || value === undefined)
        return "";
    const raw = String(value);
    if (isMysqlExpressionDefault(raw) || isNumericDefault(raw) || /^(true|false)$/i.test(raw)) {
        return raw;
    }
    return `'${raw.replace(/'/g, "''")}'`;
}
