"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAlterColumn = renderAlterColumn;
const ddl_default_1 = require("./ddl-default");
const ddl_shared_1 = require("./ddl-shared");
function renderAlterColumn(target, change) {
    const column = (0, ddl_shared_1.quoteIdent)(target, change?.column?.name || "");
    const alterType = String(change?.alter?.type || "");
    if (alterType === "set default") {
        if (target === "sqlite")
            throw new Error("SQLite does not safely support ALTER COLUMN SET DEFAULT.");
        return `ALTER COLUMN ${column} SET DEFAULT ${(0, ddl_default_1.renderDefaultExpr)(target, change.alter.default)}`;
    }
    if (alterType === "drop default") {
        if (target === "sqlite")
            throw new Error("SQLite does not safely support ALTER COLUMN DROP DEFAULT.");
        return `ALTER COLUMN ${column} DROP DEFAULT`;
    }
    if (alterType === "set type") {
        throw new Error(`ALTER COLUMN TYPE is not safely supported for ${target} yet.`);
    }
    if (alterType === "set not null" || alterType === "drop not null") {
        throw new Error(`ALTER COLUMN ${alterType.toUpperCase()} requires live column metadata and is not supported yet.`);
    }
    throw new Error(`Unsupported ALTER COLUMN change: ${alterType || "unknown"}.`);
}
