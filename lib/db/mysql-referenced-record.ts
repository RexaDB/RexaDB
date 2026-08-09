import { executeMysqlQuery } from "./mysql-client";
import { quoteMysqlIdentifier, buildKeyConditions } from "./quote-identifier";

export async function getMysqlReferencedRecord(
  connectionString: string,
  schema: string,
  table: string,
  keyValues: Record<string, unknown>,
) {
  const result = buildKeyConditions(quoteMysqlIdentifier, keyValues);
  if (!result) return { row: null, fields: [] };
  const sql = `
    SELECT *
    FROM ${quoteMysqlIdentifier(schema)}.${quoteMysqlIdentifier(table)}
    WHERE ${result.conditions.join(" AND ")}
    LIMIT 1
  `;
  const queryResult = await executeMysqlQuery(connectionString, sql, result.values);
  return { row: queryResult.rows[0] ?? null, fields: queryResult.fields };
}
