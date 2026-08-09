"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAddedConstraint = renderAddedConstraint;
const pgsql_ast_parser_1 = require("pgsql-ast-parser");
const ddl_shared_1 = require("./ddl-shared");
function quoteColumnList(target, columns = []) {
    return columns.map((column) => (0, ddl_shared_1.quoteIdent)(target, column?.name || "")).join(", ");
}
function quoteMysqlExpr(sql) {
    return sql.replace(/"/g, "`");
}
function renderAddedConstraint(target, constraint) {
    const name = constraint?.constraintName?.name;
    const prefix = name ? `CONSTRAINT ${(0, ddl_shared_1.quoteIdent)(target, name)} ` : "";
    if (constraint?.type === "unique") {
        return `ADD ${prefix}UNIQUE (${quoteColumnList(target, constraint.columns)})`;
    }
    if (constraint?.type === "primary key") {
        return `ADD ${prefix}PRIMARY KEY (${quoteColumnList(target, constraint.columns)})`;
    }
    if (constraint?.type === "foreign key") {
        const local = quoteColumnList(target, constraint.localColumns);
        const foreign = quoteColumnList(target, constraint.foreignColumns);
        const table = (0, ddl_shared_1.quoteIdent)(target, constraint?.foreignTable?.name || "");
        return `ADD ${prefix}FOREIGN KEY (${local}) REFERENCES ${table} (${foreign})`;
    }
    if (constraint?.type === "check") {
        const expr = pgsql_ast_parser_1.toSql.expr(constraint.expr);
        return `ADD ${prefix}CHECK (${target === "mysql" ? quoteMysqlExpr(expr) : expr})`;
    }
    throw new Error(`Unsupported constraint type: ${String(constraint?.type || "unknown")}.`);
}
