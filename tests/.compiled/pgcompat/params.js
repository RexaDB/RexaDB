"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compilePgParams = compilePgParams;
function compilePgParams(query, params) {
    const compiledParams = [];
    const compiledQuery = String(query || "").replace(/\$(\d+)/g, (_, rawIndex) => {
        const index = Number(rawIndex) - 1;
        compiledParams.push(index >= 0 ? params[index] : undefined);
        return "?";
    });
    return { query: compiledQuery, params: compiledParams };
}
