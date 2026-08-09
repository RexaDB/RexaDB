import { getSqlEngineReferencedRecord } from "../sql-engine";
import { getFederatedDefaultNamespace } from "./default-namespace";
import { getResolvedFederatedSource } from "./resolve-connections";

export async function getFederatedReferencedRecord(
  connectionString: string,
  alias: string,
  table: string,
  keyValues: Record<string, unknown>
) {
  const source = await getResolvedFederatedSource(connectionString, alias);
  return await getSqlEngineReferencedRecord(
    source.connectionString,
    source.namespace || getFederatedDefaultNamespace(source.connectionString),
    table,
    keyValues
  );
}
