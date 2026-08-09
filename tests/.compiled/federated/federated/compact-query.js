"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compactFederatedQuery = compactFederatedQuery;
function compactFederatedQuery(query) {
    return String(query || "")
        .replace(/\s+\./g, ".")
        .replace(/\.\s+/g, ".");
}
