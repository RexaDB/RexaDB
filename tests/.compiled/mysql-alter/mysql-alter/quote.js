"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteMysqlIdentifier = quoteMysqlIdentifier;
function quoteMysqlIdentifier(value) {
    return `\`${String(value || "").replace(/`/g, "``")}\``;
}
