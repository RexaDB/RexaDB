import { detectConnectionDbType } from "../connection-type";
import type { SqlEngineKind } from "./types";

export function getSqlEngineKind(connectionString: string): SqlEngineKind | null {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "postgres") return "postgres";
  if (dbType === "sqlite") return "sqlite";
  if (dbType === "mysql") return "mysql";
  return null;
}

export function isSupportedSqlEngine(connectionString: string) {
  return getSqlEngineKind(connectionString) !== null;
}
