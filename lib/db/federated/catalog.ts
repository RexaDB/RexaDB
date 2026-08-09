import { getDbTables, getDbViews } from "../db-engine";
import { getFederatedDefaultNamespace } from "./default-namespace";
import { parseFederatedConnectionString } from "./connection-string";
import { getResolvedFederatedSource, resolveFederatedSources } from "./resolve-connections";

export async function getFederatedSchemas(connectionString: string): Promise<string[]> {
  return parseFederatedConnectionString(connectionString).sources.map((source) => source.alias);
}

export async function getFederatedDatabases(connectionString: string): Promise<string[]> {
  return await getFederatedSchemas(connectionString);
}

export async function getFederatedTables(connectionString: string, alias: string): Promise<any> {
  const source = await getResolvedFederatedSource(connectionString, alias);
  return await getDbTables(source.connectionString, source.namespace || getFederatedDefaultNamespace(source.connectionString));
}

export async function getFederatedViews(connectionString: string, alias: string): Promise<any> {
  const source = await getResolvedFederatedSource(connectionString, alias);
  return await getDbViews(source.connectionString, source.namespace || getFederatedDefaultNamespace(source.connectionString));
}
