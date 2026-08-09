import { getDbTableForeignKeys } from "../db-engine/foreign-keys";
import { getFederatedDefaultNamespace } from "./default-namespace";
import { getResolvedFederatedSource } from "./resolve-connections";

export async function getFederatedTableForeignKeys(connectionString: string, alias: string, table: string): Promise<any[]> {
  const source = await getResolvedFederatedSource(connectionString, alias);
  const rows = await getDbTableForeignKeys(
    source.connectionString,
    source.namespace || getFederatedDefaultNamespace(source.connectionString),
    table
  );
  return rows.map((row: any) => ({
    ...row,
    foreign_table_schema: alias,
  }));
}
