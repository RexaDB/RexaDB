"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMysqlNotNullAlterQuery = exports.executeMysqlNotNullAlterQuery = exports.buildMysqlColumnDefinition = void 0;
var column_definition_1 = require("./column-definition");
Object.defineProperty(exports, "buildMysqlColumnDefinition", { enumerable: true, get: function () { return column_definition_1.buildMysqlColumnDefinition; } });
var not_null_1 = require("./not-null");
Object.defineProperty(exports, "executeMysqlNotNullAlterQuery", { enumerable: true, get: function () { return not_null_1.executeMysqlNotNullAlterQuery; } });
Object.defineProperty(exports, "isMysqlNotNullAlterQuery", { enumerable: true, get: function () { return not_null_1.isMysqlNotNullAlterQuery; } });
