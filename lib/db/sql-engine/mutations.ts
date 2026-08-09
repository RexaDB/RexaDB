import { getSqlEngineKind } from "./detect";
import type { RowUpdate } from "./types";

export async function deleteSqlEngineRows(connectionString: string, schema: string, table: string, pkColumn: string, pkValues: any[]) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).deleteSqliteRows(connectionString, schema, table, pkColumn, pkValues);
  if (engine === "mysql") return (await import("../mysql-client")).deleteRows(connectionString, schema, table, pkColumn, pkValues);
  if (engine === "postgres") return (await import("../pg-client")).deleteRows(connectionString, schema, table, pkColumn, pkValues);
  throw new Error("Unsupported SQL engine.");
}

export async function updateSqlEngineRows(connectionString: string, schema: string, table: string, updates: RowUpdate[]) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).updateSqliteRows(connectionString, schema, table, updates);
  if (engine === "mysql") return (await import("../mysql-client")).updateRows(connectionString, schema, table, updates);
  if (engine === "postgres") return (await import("../pg-client")).updateRows(connectionString, schema, table, updates);
  throw new Error("Unsupported SQL engine.");
}
