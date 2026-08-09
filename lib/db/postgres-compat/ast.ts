import { parseFirst } from "pgsql-ast-parser";

export function parsePostgresStatement(query: string) {
  return parseFirst(String(query || ""));
}
