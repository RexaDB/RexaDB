import { executeDbQuery } from "../db-engine";
import { quoteFederatedIdent } from "./quote";

export async function queryFederatedSourceTable(connectionString: string, namespace: string, table: string): Promise<any> {
  const qualified = namespace
    ? `${quoteFederatedIdent(namespace)}.${quoteFederatedIdent(table)}`
    : quoteFederatedIdent(table);
  return await executeDbQuery(connectionString, `SELECT * FROM ${qualified}`);
}
