"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAlterTable = renderAlterTable;
const ddl_alter_column_1 = require("./ddl-alter-column");
const ddl_constraints_1 = require("./ddl-constraints");
const ddl_shared_1 = require("./ddl-shared");
const ddl_default_1 = require("./ddl-default");
function renderAddedColumn(target, column) {
    const name = (0, ddl_shared_1.quoteIdent)(target, column?.name?.name || "");
    const dataType = (0, ddl_shared_1.mapTypeName)(target, String(column?.dataType?.name || "text"));
    const constraints = Array.isArray(column?.constraints) ? column.constraints : [];
    const parts = [`${name} ${dataType}`];
    if (constraints.some((constraint) => constraint?.type === "not null"))
        parts.push("NOT NULL");
    const defaultConstraint = constraints.find((constraint) => constraint?.type === "default");
    if (defaultConstraint?.default)
        parts.push(`DEFAULT ${(0, ddl_default_1.renderDefaultExpr)(target, defaultConstraint.default)}`);
    return parts.join(" ");
}
function renderAlterTable(target, statement) {
    const tableName = (0, ddl_shared_1.quoteIdent)(target, statement?.table?.name || "");
    const changes = Array.isArray(statement?.changes) ? statement.changes : [];
    if (changes.length !== 1)
        throw new Error("ALTER TABLE compatibility currently supports one change per statement.");
    const change = changes[0];
    if (change?.type === "add column") {
        return `ALTER TABLE ${tableName} ADD COLUMN ${renderAddedColumn(target, change.column)}`;
    }
    if (change?.type === "drop column") {
        return `ALTER TABLE ${tableName} DROP COLUMN ${(0, ddl_shared_1.quoteIdent)(target, change?.column?.name || "")}`;
    }
    if (change?.type === "rename column") {
        const from = (0, ddl_shared_1.quoteIdent)(target, change?.column?.name || "");
        const to = (0, ddl_shared_1.quoteIdent)(target, change?.to?.name || "");
        return `ALTER TABLE ${tableName} RENAME COLUMN ${from} TO ${to}`;
    }
    if (change?.type === "rename") {
        return `ALTER TABLE ${tableName} RENAME TO ${(0, ddl_shared_1.quoteIdent)(target, change?.to?.name || "")}`;
    }
    if (change?.type === "alter column") {
        return `ALTER TABLE ${tableName} ${(0, ddl_alter_column_1.renderAlterColumn)(target, change)}`;
    }
    if (change?.type === "add constraint") {
        if (target === "sqlite")
            throw new Error("SQLite does not safely support ALTER TABLE ADD CONSTRAINT.");
        return `ALTER TABLE ${tableName} ${(0, ddl_constraints_1.renderAddedConstraint)(target, change.constraint)}`;
    }
    if (change?.type === "drop constraint") {
        throw new Error(`ALTER TABLE DROP CONSTRAINT is not safely supported for ${target} yet.`);
    }
    if (change?.type === "rename constraint") {
        throw new Error(`ALTER TABLE RENAME CONSTRAINT is not safely supported for ${target} yet.`);
    }
    throw new Error(`Unsupported ALTER TABLE change: ${String(change?.type || "unknown")}.`);
}
