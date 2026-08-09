"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCreateTable = renderCreateTable;
const ddl_shared_1 = require("./ddl-shared");
const ddl_default_1 = require("./ddl-default");
function renderColumn(target, column) {
    const name = (0, ddl_shared_1.quoteIdent)(target, column?.name?.name || "");
    const dataTypeName = String(column?.dataType?.name || "text");
    const constraints = Array.isArray(column?.constraints) ? column.constraints : [];
    const isPrimary = constraints.some((constraint) => constraint?.type === "primary key");
    const isNotNull = constraints.some((constraint) => constraint?.type === "not null");
    const isUnique = constraints.some((constraint) => constraint?.type === "unique");
    const defaultConstraint = constraints.find((constraint) => constraint?.type === "default");
    if (target === "sqlite" && isPrimary && ["serial", "bigserial"].includes(dataTypeName.toLowerCase())) {
        return `${name} INTEGER PRIMARY KEY AUTOINCREMENT`;
    }
    const parts = [`${name} ${(0, ddl_shared_1.mapTypeName)(target, dataTypeName)}`];
    if (isPrimary)
        parts.push("PRIMARY KEY");
    if (target === "mysql" && isPrimary && ["serial", "bigserial"].includes(dataTypeName.toLowerCase())) {
        parts.push("AUTO_INCREMENT");
    }
    if (isNotNull)
        parts.push("NOT NULL");
    if (isUnique)
        parts.push("UNIQUE");
    if (defaultConstraint?.default) {
        parts.push(`DEFAULT ${(0, ddl_default_1.renderDefaultExpr)(target, defaultConstraint.default)}`);
    }
    const referenceConstraint = constraints.find((constraint) => constraint?.type === "reference");
    if (referenceConstraint?.foreignTable?.name) {
        const foreignTable = (0, ddl_shared_1.quoteIdent)(target, referenceConstraint.foreignTable.name);
        const foreignColumns = Array.isArray(referenceConstraint.foreignColumns)
            ? referenceConstraint.foreignColumns.map((col) => (0, ddl_shared_1.quoteIdent)(target, col?.name || "")).join(", ")
            : "";
        parts.push(`REFERENCES ${foreignTable}${foreignColumns ? `(${foreignColumns})` : ""}`);
    }
    return parts.join(" ");
}
function renderCreateTable(target, statement) {
    const tableName = (0, ddl_shared_1.quoteIdent)(target, statement?.name?.name || "");
    const columns = Array.isArray(statement?.columns) ? statement.columns : [];
    const renderedColumns = columns.map((column) => renderColumn(target, column));
    return `CREATE TABLE ${tableName} (${renderedColumns.join(", ")})`;
}
