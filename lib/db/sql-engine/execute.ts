import { getSqlEngineKind } from "./detect";
import { compilePostgresQuery } from "../postgres-compat";
import type { QueryOptions } from "./types";

export async function executeSqlEngineQuery(
  connectionString: string,
  query: string,
  params: any[] = [],
  options: QueryOptions = {}
) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") {
    const { executeSqliteQuery } = await import("../sqlite-client");
    const compiled = compilePostgresQuery(query, params, "sqlite");
    return await executeSqliteQuery(connectionString, compiled.query, compiled.params);
  }
  if (engine === "mysql") {
    const { executeMysqlSqlEngineQuery } = await import("./mysql-execute");
    return await executeMysqlSqlEngineQuery(connectionString, query, params);
  }
  if (engine === "postgres") {
    const { executeQuery } = await import("../pg-client");
    const compiled = compilePostgresQuery(query, params, "postgres");
    return await executeQuery(connectionString, compiled.query, compiled.params, options);
  }
  throw new Error("Unsupported SQL engine.");
}
