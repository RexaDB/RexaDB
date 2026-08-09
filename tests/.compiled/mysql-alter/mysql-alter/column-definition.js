"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMysqlColumnDefinition = buildMysqlColumnDefinition;
const default_1 = require("./default");
const quote_1 = require("./quote");
function buildMysqlColumnDefinition(column, isNullable) {
    const name = (0, quote_1.quoteMysqlIdentifier)(column?.column_name || "");
    const dataType = String(column?.column_type || "").trim();
    if (!dataType)
        throw new Error(`Missing MySQL column_type for ${String(column?.column_name || "column")}.`);
    const parts = [name, dataType, isNullable ? "NULL" : "NOT NULL"];
    if (column?.column_default !== null && column?.column_default !== undefined) {
        parts.push(`DEFAULT ${(0, default_1.renderMysqlDefaultValue)(column.column_default)}`);
    }
    const extra = String(column?.extra || "").trim();
    if (extra)
        parts.push(extra.toUpperCase());
    return parts.join(" ");
}
