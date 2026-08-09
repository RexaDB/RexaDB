const PG_CAST_RE = /(\$\d+|\?|"[^"]+"|`[^`]+`|'[^']*'|\b[a-zA-Z_][\w.]*\b|\([^()]+\))::([a-zA-Z_][\w]*)/g;

function mapCastType(rawType: string) {
  const type = String(rawType || "").trim().toLowerCase();
  if (type === "int4" || type === "integer") return "INTEGER";
  if (type === "int8" || type === "bigint") return "BIGINT";
  if (type === "float4" || type === "float8" || type === "numeric" || type === "decimal") return "DECIMAL";
  if (type === "bool" || type === "boolean") return "BOOLEAN";
  if (type === "jsonb") return "JSON";
  return rawType.toUpperCase();
}

export function compilePgCasts(query: string) {
  return String(query || "").replace(PG_CAST_RE, (_, expr, rawType) => `CAST(${expr} AS ${mapCastType(rawType)})`);
}
