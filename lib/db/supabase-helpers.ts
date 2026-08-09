import { normalizePgConnectionString } from "./pg-connection";

export const SUPABASE_DUMP_EXCLUDED_SCHEMA_PATTERNS = [
  "information_schema",
  "pg_*",
  "_analytics",
  "_realtime",
  "_supavisor",
  "auth",
  "extensions",
  "pgbouncer",
  "realtime",
  "storage",
  "supabase_functions",
  "supabase_migrations",
  "cron",
  "dbdev",
  "graphql",
  "graphql_public",
  "net",
  "pgmq",
  "pgsodium",
  "pgsodium_masks",
  "pgtle",
  "repack",
  "tiger",
  "tiger_data",
  "timescaledb_*",
  "_timescaledb_*",
  "topology",
  "vault",
];

export function isLikelySupabaseConnection(connectionString: string): boolean {
  try {
    const host = new URL(normalizePgConnectionString(connectionString)).hostname.toLowerCase();
    return host.includes("supabase.co") || host.includes("supabase.in");
  } catch {
    return false;
  }
}

export function schemaMatchesPattern(schemaName: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return schemaName === pattern;
  }
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(schemaName);
}

export function isSupabaseExcludedSchema(schemaName: string): boolean {
  return SUPABASE_DUMP_EXCLUDED_SCHEMA_PATTERNS.some((pattern) => schemaMatchesPattern(schemaName, pattern));
}
