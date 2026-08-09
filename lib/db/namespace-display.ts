import type { ConnectionDbType } from "./connection-type";

const DATABASE_NAMESPACE_ENGINES = new Set<ConnectionDbType>([
  "mongodb",
  "redis",
  "sqlite",
  "mysql",
  "clickhouse",
  "spacetimedb",
]);

export function usesDatabaseNamespaces(dbType: ConnectionDbType) {
  return DATABASE_NAMESPACE_ENGINES.has(dbType);
}

export function getNamespaceLabel(dbType: ConnectionDbType) {
  return usesDatabaseNamespaces(dbType) ? "database" : "schema";
}

export function getNamespaceLabelPlural(dbType: ConnectionDbType) {
  return usesDatabaseNamespaces(dbType) ? "databases" : "schemas";
}
