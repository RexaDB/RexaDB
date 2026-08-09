"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatementKind = getStatementKind;
function getStatementKind(query) {
    const match = String(query || "").trim().match(/^([a-z]+)/i);
    return String(match?.[1] || "").toUpperCase();
}
