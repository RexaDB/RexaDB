import { getDbAllTablesWithColumns, getDbTableStructure } from "../db-engine";
import { getFederatedDefaultNamespace } from "./default-namespace";
import { getResolvedFederatedSource, resolveFederatedSources } from "./resolve-connections";

export async function getFederatedTableStructure(connectionString: string, alias: string, table: string): Promise<any> {
  const source = await getResolvedFederatedSource(connectionString, alias);
  return await getDbTableStructure(source.connectionString, source.namespace || getFederatedDefaultNamespace(source.connectionString), table);
}

export async function getFederatedAllTablesWithColumns(connectionString: string): Promise<any[]> {
  const sources = await resolveFederatedSources(connectionString);
  const loaded: Array<{ alias: string; rows: any[] }> = await Promise.all(sources.map(async (source) => ({
    alias: source.alias,
    rows: await getDbAllTablesWithColumns(source.connectionString),
  })));
  return loaded.flatMap((entry: { alias: string; rows: any[] }) => entry.rows.map((row: any) => ({
    ...row,
    table_schema: entry.alias,
    referenced_table_schema: row?.referenced_table_name ? entry.alias : null,
  })));
}
