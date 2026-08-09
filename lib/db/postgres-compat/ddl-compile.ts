import type { PgCompatTarget } from "./types";
import { renderAlterTable } from "./ddl-alter-table";
import { renderCreateTable } from "./ddl-create-table";
import { renderGenericDdl } from "./ddl-generic";

export function compileDdlStatement(target: PgCompatTarget, statement: any) {
  const type = String(statement?.type || "");
  if (type === "create table") return renderCreateTable(target, statement);
  if (type === "alter table") return renderAlterTable(target, statement);
  if (type === "create index" || type === "drop table" || type === "drop index") {
    return renderGenericDdl(target, statement);
  }
  if (type === "create schema") {
    throw new Error(`CREATE SCHEMA is not supported for ${target}.`);
  }
  throw new Error(`Unsupported DDL statement type: ${type || "unknown"}.`);
}
