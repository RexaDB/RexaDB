import { getStatementKind } from "./statement-kind";

const SUPPORTED_KINDS = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
]);

export function assertSupportedStatement(query: string) {
  const kind = getStatementKind(query);
  if (SUPPORTED_KINDS.has(kind)) return;
  throw new Error(`Postgres compatibility compiler does not support ${kind || "unknown"} yet.`);
}
