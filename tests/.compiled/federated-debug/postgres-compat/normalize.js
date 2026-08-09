"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePgSyntax = normalizePgSyntax;
function normalizePgSyntax(query) {
    return String(query || "").replace(/SELECT\s+ALL\s+FROM/gi, "SELECT * FROM");
}
