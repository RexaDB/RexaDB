import { getSqlEngineKind } from "./detect";

export async function getSqlEngineTableStructure(connectionString: string, schema: string, table: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqliteTableStructure(connectionString, schema, table);
  if (engine === "mysql") return (await import("../mysql-client")).getTableStructure(connectionString, schema, table);
  if (engine === "postgres") return (await import("../pg-client")).getTableStructure(connectionString, schema, table);
  throw new Error("Unsupported SQL engine.");
}

export async function getSqlEngineTableForeignKeys(connectionString: string, schema: string, table: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqliteForeignKeys(connectionString, schema, table);
  if (engine === "mysql") return (await import("../mysql-client")).getTableForeignKeys(connectionString, schema, table);
  if (engine === "postgres") return (await import("../pg-client")).getTableForeignKeys(connectionString, schema, table);
  throw new Error("Unsupported SQL engine.");
}

export async function getSqlEnginePrimaryKey(connectionString: string, schema: string, table: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqlitePrimaryKey(connectionString, schema, table);
  if (engine === "mysql") return (await import("../mysql-client")).getTablePrimaryKey(connectionString, schema, table);
  if (engine === "postgres") return (await import("../pg-client")).getTablePrimaryKey(connectionString, schema, table);
  throw new Error("Unsupported SQL engine.");
}
