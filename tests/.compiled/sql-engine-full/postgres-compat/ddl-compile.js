"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileDdlStatement = compileDdlStatement;
const ddl_alter_table_1 = require("./ddl-alter-table");
const ddl_create_table_1 = require("./ddl-create-table");
const ddl_generic_1 = require("./ddl-generic");
function compileDdlStatement(target, statement) {
    const type = String(statement?.type || "");
    if (type === "create table")
        return (0, ddl_create_table_1.renderCreateTable)(target, statement);
    if (type === "alter table")
        return (0, ddl_alter_table_1.renderAlterTable)(target, statement);
    if (type === "create index" || type === "drop table" || type === "drop index") {
        return (0, ddl_generic_1.renderGenericDdl)(target, statement);
    }
    if (type === "create schema") {
        throw new Error(`CREATE SCHEMA is not supported for ${target}.`);
    }
    throw new Error(`Unsupported DDL statement type: ${type || "unknown"}.`);
}
