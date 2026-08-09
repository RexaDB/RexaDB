import { detectConnectionDbType } from "../connection-type";
import { getDatabaseFromConnectionString } from "../../studio/db-utils";

export function getFederatedDefaultNamespace(connectionString: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "sqlite") return "main";
  if (dbType === "mysql") return getDatabaseFromConnectionString(connectionString);
  return "public";
}
