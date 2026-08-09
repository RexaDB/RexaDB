"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeFederatedRewrittenQuery = normalizeFederatedRewrittenQuery;
function normalizeFederatedRewrittenQuery(query) {
    const normalized = String(query || "")
        .replace(/\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^()]*)\)\s*\)/g, (_, fn, args) => `${fn}(${String(args || "").trim()})`)
        .replace(/\b(count|max|min|sum|avg|lower|upper)\s+\(/gi, (_, fn) => `${fn}(`)
        .replace(/\(\s*\*\s*\)/g, "(*)")
        .replace(/\bOFFSET\s*\(\s*(\d+)\s*\)\s*LIMIT\s*\(\s*(\d+)\s*\)/gi, "LIMIT $2 OFFSET $1")
        .replace(/\bLIMIT\s*\(\s*(\d+)\s*\)/gi, "LIMIT $1")
        .replace(/\bOFFSET\s*\(\s*(\d+)\s*\)/gi, "OFFSET $1");
    if (!/\b(UNION ALL|UNION|INTERSECT|EXCEPT)\b/i.test(normalized)) {
        return normalized;
    }
    return normalized
        .replace(/\(\s*SELECT/gi, "SELECT")
        .replace(/\)\s*(UNION ALL|UNION|INTERSECT|EXCEPT)/gi, " $1")
        .replace(/(UNION ALL|UNION|INTERSECT|EXCEPT)\s*\(\s*SELECT/gi, "$1 SELECT")
        .replace(/\)\s*$/g, "");
}
