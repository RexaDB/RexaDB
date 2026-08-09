"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSupportedReturning = assertSupportedReturning;
const RETURNING_RE = /\bRETURNING\b/i;
function assertSupportedReturning(query, target) {
    if (target !== "mysql")
        return;
    if (!RETURNING_RE.test(query))
        return;
    throw new Error("PostgreSQL RETURNING is not supported for MySQL yet.");
}
