import type { PgCompatTarget } from "./types";

export function quoteIdent(target: PgCompatTarget, name: string) {
  if (target === "mysql") return `\`${String(name || "").replace(/`/g, "``")}\``;
  return `"${String(name || "").replace(/"/g, '""')}"`;
}

export function mapTypeName(target: PgCompatTarget, typeName: string) {
  const type = String(typeName || "").trim().toLowerCase();
  if (target === "mysql") {
    if (type === "timestamptz" || type === "timestamp with time zone") return "DATETIME";
    if (type === "jsonb") return "JSON";
    if (type === "boolean") return "BOOLEAN";
    if (type === "serial") return "INTEGER";
    if (type === "bigserial") return "BIGINT";
    return typeName.toUpperCase();
  }
  if (target === "sqlite") {
    if (type === "boolean") return "INTEGER";
    if (type === "jsonb" || type === "json") return "TEXT";
    if (type === "timestamptz" || type === "timestamp with time zone") return "DATETIME";
    if (type === "serial" || type === "bigserial") return "INTEGER";
    return typeName.toUpperCase();
  }
  return typeName;
}
