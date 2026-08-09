"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compilePostgresQuery = compilePostgresQuery;
const ast_1 = require("./ast");
const ddl_compile_1 = require("./ddl-compile");
const casts_1 = require("./casts");
const ilike_1 = require("./ilike");
const mysql_compile_1 = require("./mysql-compile");
const normalize_1 = require("./normalize");
const params_1 = require("./params");
const returning_1 = require("./returning");
const validate_1 = require("./validate");
function compilePostgresQuery(query, params, target) {
    const normalized = (0, normalize_1.normalizePgSyntax)(query);
    (0, validate_1.assertSupportedStatement)(normalized);
    const statement = (0, ast_1.parsePostgresStatement)(normalized);
    if (target === "postgres")
        return { query: normalized, params };
    if (["create table", "alter table", "create index", "drop table", "drop index", "create schema"].includes(String(statement?.type || ""))) {
        return { query: (0, ddl_compile_1.compileDdlStatement)(target, statement), params: [] };
    }
    const castCompiled = (0, casts_1.compilePgCasts)(normalized);
    const ilikeCompiled = (0, ilike_1.compilePgIlike)(castCompiled);
    if (target === "sqlite") {
        (0, returning_1.assertSupportedReturning)(ilikeCompiled, "sqlite");
        return (0, params_1.compilePgParams)(ilikeCompiled, params);
    }
    return (0, params_1.compilePgParams)((0, mysql_compile_1.compileMysqlQuery)(ilikeCompiled), params);
}
