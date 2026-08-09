import { getDbTableStructure } from "../db-engine";
import { getFederatedDefaultNamespace } from "./default-namespace";
import { normalizeFederatedValue } from "./normalize-value";
import { queryFederatedSourceTable } from "./source-query";

export async function loadFederatedTable(source: { connectionString: string; namespace?: string }, table: string): Promise<{
  namespace: string;
  columns: Array<{ name: string; dataType: string }>;
  rows: Record<string, unknown>[];
}> {
  const namespace = source.namespace || getFederatedDefaultNamespace(source.connectionString);
  const structure = await getDbTableStructure(source.connectionString, namespace, table);
  const result: { rows: Record<string, unknown>[] } = await queryFederatedSourceTable(source.connectionString, namespace, table);
  return {
    namespace,
    columns: structure.map((column: any) => ({
      name: String(column?.column_name || ""),
      dataType: String(column?.data_type || "text"),
    })),
    rows: result.rows.map((row: Record<string, unknown>) => Object.fromEntries(
      Object.entries(row || {}).map(([key, value]) => [key, normalizeFederatedValue(value)])
    )),
  };
}
