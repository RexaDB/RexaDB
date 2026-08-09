import { parsePostgresStatement } from "./ast";
import { compileDdlStatement } from "./ddl-compile";
import { compilePgCasts } from "./casts";
import { compilePgIlike } from "./ilike";
import { compileMysqlQuery } from "./mysql-compile";
import { normalizePgSyntax } from "./normalize";
import { compilePgParams } from "./params";
import { assertSupportedReturning } from "./returning";
import { assertSupportedStatement } from "./validate";
import type { CompiledQuery, PgCompatTarget } from "./types";

export function compilePostgresQuery(query: string, params: any[], target: PgCompatTarget): CompiledQuery {
  const normalized = normalizePgSyntax(query);
  if (target === "postgres") {
    // For native Postgres connections, don't parse/validate here; forward as-is.
    // The AST parser does not cover all valid Postgres DDL (e.g., CREATE TRIGGER).
    return { query: normalized, params };
  }

  const statement = parsePostgresStatement(normalized);
  if (!["union", "union all", "intersect", "except"].includes(String(statement?.type || ""))) {
    assertSupportedStatement(normalized);
  }
  if (["create table", "alter table", "create index", "drop table", "drop index", "create schema"].includes(String(statement?.type || ""))) {
    return { query: compileDdlStatement(target, statement), params: [] };
  }

  const castCompiled = compilePgCasts(normalized);
  const ilikeCompiled = compilePgIlike(castCompiled);
  if (target === "sqlite") {
    assertSupportedReturning(ilikeCompiled, "sqlite");
    return compilePgParams(ilikeCompiled, params);
  }
  return compilePgParams(compileMysqlQuery(ilikeCompiled), params);
}
