import { eq, inArray } from "drizzle-orm";
import { detectConnectionDbType } from "../connection-type";
import { db } from "../index";
import { connections } from "../schema";
import { parseFederatedConnectionString } from "./connection-string";

const SQL_FEDERATED_ENGINES = new Set(["postgres", "sqlite", "mysql"]);

export async function resolveFederatedSources(connectionString: string) {
  const config = parseFederatedConnectionString(connectionString);
  const ids = config.sources.map((source) => source.connectionId);
  const rows = await db.select().from(connections).where(inArray(connections.id, ids));
  return config.sources.map((source) => {
    const connection = rows.find((row) => row.id === source.connectionId);
    if (!connection) throw new Error(`Federated source "${source.alias}" points to a missing connection.`);
    const dbType = detectConnectionDbType(connection.connectionString);
    if (!SQL_FEDERATED_ENGINES.has(dbType)) {
      throw new Error(`Federated source "${source.alias}" must be postgres, sqlite/libsql, or mysql.`);
    }
    if (dbType === "federated") throw new Error("Nested federated connections are not supported.");
    return { ...source, connectionString: connection.connectionString, dbType, name: connection.name };
  });
}

export async function getResolvedFederatedSource(connectionString: string, alias: string) {
  const sources = await resolveFederatedSources(connectionString);
  const source = sources.find((entry) => entry.alias === alias);
  if (!source) throw new Error(`Unknown federated source alias "${alias}".`);
  return source;
}
