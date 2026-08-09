"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compilePgIlike = compilePgIlike;
const PG_ILIKE_RE = /(\([^()]+\)|"[^"]+"|`[^`]+`|\b[a-zA-Z_][\w.]*\b)\s+(NOT\s+)?ILIKE\s+(\$\d+|\?|'[^']*'|\([^()]+\)|"[^"]+"|`[^`]+`|\b[a-zA-Z_][\w.]*\b)/gi;
function compilePgIlike(query) {
    return String(query || "").replace(PG_ILIKE_RE, (_, left, notWord = "", right) => `LOWER(${left}) ${notWord ? "NOT " : ""}LIKE LOWER(${right})`);
}
