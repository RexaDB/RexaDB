/**
 * Shared SQL guard helpers for agent DB tools.
 * Single source for lib/agents/db-tools-core.ts and lib/ai/pi-tools.ts.
 */

export type DbCapability = {
  supportsNamespaces: boolean;
  supportsStructuredSchema: boolean;
  supportsRelatedTables: boolean;
  supportsReadOnlyQuery: boolean;
  supportsSampleRows: boolean;
  querySyntax: "mongo-json-or-shell" | "redis-command" | "sql";
};

export function getDbCapabilities(dbType: string): DbCapability {
  return {
    supportsNamespaces: dbType !== "redis",
    supportsStructuredSchema: dbType !== "redis",
    supportsRelatedTables: !["mongodb", "redis", "clickhouse", "trino"].includes(dbType),
    supportsReadOnlyQuery: dbType !== "redis",
    supportsSampleRows: dbType !== "redis",
    querySyntax:
      dbType === "mongodb"
        ? "mongo-json-or-shell"
        : dbType === "redis"
          ? "redis-command"
          : "sql",
  };
}

export function ensureReadOnlySql(query: string): void {
  const normalized = String(query || "").trim().replace(/;+$/g, "");
  if (!normalized) throw new Error("SQL is required.");
  if (!/^(select|with|explain)\b/i.test(normalized)) {
    throw new Error("Only read-only SQL is allowed. Use SELECT, WITH, or EXPLAIN.");
  }
  if (
    /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|comment|vacuum|analyze|refresh|reindex|call|do|copy)\b/i.test(
      normalized,
    )
  ) {
    throw new Error("Potentially mutating SQL was rejected.");
  }
}

export function quoteIdentifier(dbType: string, value: string): string {
  if (dbType === "mysql" || dbType === "clickhouse") return `\`${value.replace(/`/g, "``")}\``;
  if (dbType === "mssql") return `[${value.replace(/]/g, "]]")}]`;
  return `"${value.replace(/"/g, '""')}"`;
}

export function tableRef(dbType: string, schema: string, table: string): string {
  if (!schema || dbType === "spacetimedb") return quoteIdentifier(dbType, table);
  return `${quoteIdentifier(dbType, schema)}.${quoteIdentifier(dbType, table)}`;
}

/**
 * Append dialect-aware ORDER BY + limit/offset to a SELECT.
 * Oracle and SQL Server use OFFSET/FETCH (no LIMIT).
 * `orderBySql` should be the expression only (e.g. `"ID" ASC`), or empty
 * when the caller wants a stable dummy order for OFFSET/FETCH dialects.
 */
export function buildOrderLimitSql(opts: {
  dbType: string;
  limit: number;
  offset?: number;
  /** Already-quoted ORDER BY body, without the ORDER BY keyword. */
  orderBySql?: string;
}): string {
  const dbType = String(opts.dbType || "").toLowerCase();
  const limit = Math.max(0, Math.floor(Number(opts.limit) || 0));
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const orderBySql = String(opts.orderBySql || "").trim();

  if (dbType === "mssql" || dbType === "oracle") {
    const order =
      orderBySql ||
      (dbType === "oracle" ? "1" : "(SELECT 1)");
    return ` ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }

  if (dbType === "trino" || dbType === "spacetimedb") {
    const order = orderBySql ? ` ORDER BY ${orderBySql}` : "";
    return `${order} LIMIT ${limit}`;
  }

  const order = orderBySql ? ` ORDER BY ${orderBySql}` : "";
  return `${order} LIMIT ${limit} OFFSET ${offset}`;
}

export function buildSampleQuery(dbType: string, schema: string, table: string, limit: number): string {
  const ref = tableRef(dbType, schema, table);
  if (dbType === "mssql") return `SELECT TOP ${limit} * FROM ${ref};`;
  if (dbType === "oracle") {
    return `SELECT * FROM ${ref}${buildOrderLimitSql({ dbType, limit, offset: 0 })};`;
  }
  return `SELECT * FROM ${ref} LIMIT ${limit};`;
}
