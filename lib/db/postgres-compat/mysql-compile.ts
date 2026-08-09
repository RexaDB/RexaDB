import { assertSupportedReturning } from "./returning";
import { compileMysqlIdentifiers } from "./mysql-identifiers";
import { compileMysqlUpsert } from "./mysql-upsert";

export function compileMysqlQuery(query: string) {
  assertSupportedReturning(query, "mysql");
  const withUpsert = compileMysqlUpsert(query);
  return compileMysqlIdentifiers(withUpsert);
}
