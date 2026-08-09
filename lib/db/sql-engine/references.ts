import { getSqlEngineKind } from "./detect";
import { buildSelectByKeyValuesQuery } from "../pg-query-utils";

export async function getSqlEngineReferencedRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>
) {
  const engine = getSqlEngineKind(connectionString);
  if (engine === "sqlite") {
    return (await import("../sqlite-client")).getSqliteReferencedRecord(connectionString, schema, table, keyValues);
  }
  if (engine === "mysql") {
    return (await import("../mysql-referenced-record")).getMysqlReferencedRecord(connectionString, schema, table, keyValues);
  }
  if (engine === "postgres") {
    const { executeQuery } = await import("../pg-client");
    const built = buildSelectByKeyValuesQuery(schema, table, keyValues);
    if (!built) {
      return { row: null, fields: [] };
    }
    const result = await executeQuery(connectionString, built.query, built.values);
    return { row: result.rows[0] ?? null, fields: result.fields };
  }
  throw new Error("Unsupported SQL engine.");
}
