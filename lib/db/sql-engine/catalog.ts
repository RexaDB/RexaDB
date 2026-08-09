import { getSqlEngineKind } from "./detect";

export async function getSqlEngineTables(connectionString: string, schema: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqliteTables(connectionString, schema || "main");
  if (engine === "mysql") return (await import("../mysql-client")).getTables(connectionString, schema);
  if (engine === "postgres") return (await import("../pg-client")).getTables(connectionString, schema);
  throw new Error("Unsupported SQL engine.");
}

export async function getSqlEngineViews(connectionString: string, schema: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqliteViews(connectionString, schema || "main");
  if (engine === "mysql") return (await import("../mysql-client")).getViews(connectionString, schema);
  if (engine === "postgres") return (await import("../pg-client")).getViews(connectionString, schema);
  throw new Error("Unsupported SQL engine.");
}

export async function getSqlEngineSchemas(connectionString: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") {
    const schemas = await (await import("../sqlite-client")).getSqliteSchemas(connectionString);
    return schemas.length ? schemas : ["main"];
  }
  if (engine === "mysql") return (await import("../mysql-client")).getSchemas(connectionString);
  if (engine === "postgres") return (await import("../pg-client")).getSchemas(connectionString);
  throw new Error("Unsupported SQL engine.");
}

export async function getSqlEngineDatabases(connectionString: string) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") return (await import("../sqlite-client")).getSqliteDatabases(connectionString);
  if (engine === "mysql") return (await import("../mysql-client")).getDatabases(connectionString);
  if (engine === "postgres") return (await import("../pg-client")).getDatabases(connectionString);
  throw new Error("Unsupported SQL engine.");
}
