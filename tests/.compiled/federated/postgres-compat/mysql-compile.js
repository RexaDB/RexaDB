"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileMysqlQuery = compileMysqlQuery;
const returning_1 = require("./returning");
const mysql_identifiers_1 = require("./mysql-identifiers");
const mysql_upsert_1 = require("./mysql-upsert");
function compileMysqlQuery(query) {
    (0, returning_1.assertSupportedReturning)(query, "mysql");
    const withUpsert = (0, mysql_upsert_1.compileMysqlUpsert)(query);
    return (0, mysql_identifiers_1.compileMysqlIdentifiers)(withUpsert);
}
