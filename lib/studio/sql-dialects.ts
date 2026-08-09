type SqlDialect =
  | "postgres"
  | "sqlite"
  | "mysql"
  | "clickhouse"
  | "mssql"
  | "trino"
  | "spacetimedb";

interface SqlContinuationRule {
  phrase: string;
  keywords?: string[];
  preferTables?: boolean;
  preferColumns?: boolean;
  preferFunctions?: boolean;
  suppressSchemaItems?: boolean;
}

const DIALECT_KEYWORDS: Record<SqlDialect, string[]> = {
  postgres: [
    "ILIKE", "RETURNING", "SERIAL", "BIGSERIAL", "SMALLSERIAL", "JSONB", "TIMESTAMPTZ",
    "LATERAL", "MATERIALIZED", "UNLOGGED", "UPSERT", "DO", "NOTHING", "CONFLICT",
    "POLICY", "RLS", "VACUUM", "ANALYZE",
  ],
  sqlite: [
    "PRAGMA", "VACUUM", "WITHOUT", "ROWID", "AUTOINCREMENT", "REPLACE", "GLOB",
    "COLLATE", "ATTACH", "DETACH",
  ],
  mysql: [
    "SHOW", "DESCRIBE", "EXPLAIN", "RENAME", "OPTIMIZE", "REPAIR", "AUTO_INCREMENT",
    "ENGINE", "UNSIGNED", "ZEROFILL", "REGEXP",
  ],
  clickhouse: [
    "FORMAT", "ENGINE", "MERGETREE", "ORDER", "BY", "SETTINGS", "PREWHERE", "SAMPLE",
    "FINAL", "TTL", "PARTITION", "LOWCARDINALITY",
  ],
  mssql: [
    "TOP", "OUTPUT", "NVARCHAR", "BIT", "DATETIME2", "OFFSET", "ROWS", "FETCH",
    "NEXT", "PERCENT", "IDENTITY", "GO", "EXEC", "EXECUTE",
  ],
  trino: [
    "SHOW", "DESCRIBE", "EXPLAIN", "USE", "CATALOGS", "SCHEMAS", "TABLES", "COLUMNS",
    "PREPARE", "EXECUTE", "DEALLOCATE",
  ],
  spacetimedb: [
    "REDUCER", "SUBSCRIBE", "IDENTITY", "SET", "SHOW",
  ],
};

const DIALECT_RULES: Record<SqlDialect, SqlContinuationRule[]> = {
  postgres: [
    { phrase: "returning", preferColumns: true, suppressSchemaItems: false },
    { phrase: "on", keywords: ["CONFLICT"] },
    { phrase: "on conflict", keywords: ["DO"] },
    { phrase: "do", keywords: ["NOTHING", "UPDATE"] },
  ],
  sqlite: [
    { phrase: "pragma", keywords: ["table_info", "index_list", "foreign_key_list"], suppressSchemaItems: true },
  ],
  mysql: [
    { phrase: "show", keywords: ["DATABASES", "TABLES", "COLUMNS", "INDEX", "CREATE"], suppressSchemaItems: true },
    { phrase: "describe", preferTables: true, suppressSchemaItems: false },
  ],
  clickhouse: [
    { phrase: "order", keywords: ["BY"], suppressSchemaItems: true },
    { phrase: "by", preferColumns: true },
    { phrase: "format", keywords: ["JSON", "JSONEachRow", "CSV", "TSV", "Pretty"], suppressSchemaItems: true },
    { phrase: "engine", keywords: ["MergeTree", "ReplacingMergeTree", "SummingMergeTree"], suppressSchemaItems: true },
  ],
  mssql: [
    { phrase: "select", keywords: ["TOP", "DISTINCT", "ALL"], preferColumns: true, preferFunctions: true },
    { phrase: "top", keywords: ["(", "PERCENT"], suppressSchemaItems: true },
    { phrase: "offset", keywords: ["ROWS"], suppressSchemaItems: true },
    { phrase: "fetch", keywords: ["NEXT", "FIRST"], suppressSchemaItems: true },
    { phrase: "fetch next", keywords: ["ROWS"], suppressSchemaItems: true },
  ],
  trino: [
    { phrase: "show", keywords: ["CATALOGS", "SCHEMAS", "TABLES", "COLUMNS", "FUNCTIONS"], suppressSchemaItems: true },
    { phrase: "describe", preferTables: true, suppressSchemaItems: false },
    { phrase: "use", keywords: ["catalog", "schema"], suppressSchemaItems: true },
  ],
  spacetimedb: [
    { phrase: "set", keywords: ["row_limit"], suppressSchemaItems: true },
    { phrase: "show", keywords: ["row_limit"], suppressSchemaItems: true },
  ],
};

const BASE_RULES: SqlContinuationRule[] = [
  { phrase: "select", keywords: ["*", "DISTINCT", "ALL"], preferColumns: true, preferFunctions: true, suppressSchemaItems: true },
  { phrase: "select *", keywords: ["FROM"], suppressSchemaItems: true },
  { phrase: "select all", keywords: ["*", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX", "NULL", "TRUE", "FALSE"], preferFunctions: true, suppressSchemaItems: true },
  { phrase: "select distinct", keywords: ["*", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX", "NULL", "TRUE", "FALSE"], preferFunctions: true, suppressSchemaItems: true },
  { phrase: "from", preferTables: true },
  { phrase: "join", preferTables: true },
  { phrase: "update", preferTables: true },
  { phrase: "into", preferTables: true },
  { phrase: "where", preferColumns: true, preferFunctions: true },
  { phrase: "on", preferColumns: true, preferFunctions: true },
  { phrase: "having", preferColumns: true, preferFunctions: true },
  { phrase: "set", preferColumns: true },
  { phrase: "group", keywords: ["BY"], suppressSchemaItems: true },
  { phrase: "order", keywords: ["BY"], suppressSchemaItems: true },
  { phrase: "group by", preferColumns: true },
  { phrase: "order by", preferColumns: true },
  { phrase: "union", keywords: ["ALL", "SELECT"], suppressSchemaItems: true },
  { phrase: "union all", keywords: ["SELECT"], suppressSchemaItems: true },
  { phrase: "insert", keywords: ["INTO"], suppressSchemaItems: true },
  { phrase: "insert into", preferTables: true },
  { phrase: "delete", keywords: ["FROM"], suppressSchemaItems: true },
  { phrase: "limit", keywords: ["10", "100", "1000"], suppressSchemaItems: true },
];

function normalize(value: string) {
  return value.toLowerCase();
}

export function getSqlDialectKeywords(dbType?: string) {
  const dialect = (dbType || "postgres") as SqlDialect;
  return Array.from(new Set([...(DIALECT_KEYWORDS[dialect] || [])]));
}

export function getSqlContinuationRule(dbType: string | undefined, tokens: string[]) {
  const normalizedTokens = tokens.map(normalize);
  const dialect = (dbType || "postgres") as SqlDialect;
  const phrases = [
    normalizedTokens.slice(-3).join(" ").trim(),
    normalizedTokens.slice(-2).join(" ").trim(),
    normalizedTokens.slice(-1).join(" ").trim(),
  ].filter(Boolean);
  const rules = [...(DIALECT_RULES[dialect] || []), ...BASE_RULES];

  for (const phrase of phrases) {
    const match = rules.find((rule) => rule.phrase === phrase);
    if (match) return match;
  }

  return null;
}
