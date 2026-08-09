"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteFederatedIdent = quoteFederatedIdent;
function quoteFederatedIdent(value) {
    return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}
