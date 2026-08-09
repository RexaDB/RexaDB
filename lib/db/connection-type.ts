export type ConnectionDbType = "postgres" | "mongodb" | "sqlite" | "mysql" | "clickhouse" | "mssql" | "redis" | "trino" | "duckdb" | "federated" | "spacetimedb" | "jdbc" | "supabase-mgmt";

function isLikelyTrinoHttpUrl(connectionString: string) {
  try {
    const parsed = new URL(String(connectionString || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    const path = (parsed.pathname || "").toLowerCase();
    if (host.includes("trino")) return true;
    if (path.includes("/v1/statement") || path === "/ui" || path === "/ui/") return true;
    if (parsed.searchParams.has("catalog") || parsed.searchParams.has("schema")) return true;
    return false;
  } catch {
    return false;
  }
}

function isDuckdbConnectionString(connectionString: string) {
  const raw = String(connectionString || "").trim().toLowerCase();
  if (raw.startsWith("duckdb://")) return true;
  if (raw.endsWith(".duckdb") || raw.endsWith(".ddb")) return true;
  if (raw === ":memory:" && raw.includes("duckdb")) return true;
  return false;
}

function isSqliteConnectionString(connectionString: string) {
  const raw = String(connectionString || "").trim().toLowerCase();
  const hasExplicitProtocol = raw.includes("://");

  return raw === ":memory:"
    || raw.startsWith("libsql://")
    || raw.startsWith("sqlite:")
    || raw.startsWith("file:")
    || raw.startsWith("/")
    || /^[a-z]:[\\\/]/i.test(raw)
    || raw.startsWith("./")
    || raw.startsWith("../")
    || raw.startsWith("~")
    || (!hasExplicitProtocol && raw.length > 0 && !raw.includes("=") && !raw.includes("@"));
}

function isMysqlConnectionString(connectionString: string) {
  const raw = String(connectionString || "").trim().toLowerCase();
  if (raw.startsWith("mysql://")
    || raw.startsWith("mariadb://")
    || raw.startsWith("mysql:/")
    || raw.startsWith("mariadb:/")) {
    return true;
  }
  if (!raw.includes("://")) {
    return /:(3306|33060)(?:\/|$)/.test(raw);
  }
  return false;
}

export function detectConnectionDbType(connectionString: string, savedType?: string | null): ConnectionDbType {
  const raw = String(connectionString || "").trim().toLowerCase();
  if (raw.startsWith("supabase-mgmt://")) {
    return "supabase-mgmt";
  }
  if (raw.startsWith("spacetimedb://") || raw.startsWith("spacetimedbs://")) {
    return "spacetimedb";
  }
  if (savedType) {
    const normalized = String(savedType).toLowerCase().trim();
    if (normalized === "postgresql" || normalized === "postgres") return "postgres";
    if (normalized === "sqlserver" || normalized === "mssql") return "mssql";
    if (normalized === "mariadb") return "mysql";
    if (normalized === "turso") return "sqlite";
    if (["supabase", "neon", "timescale", "cockroachdb", "yugabytedb", "redshift"].includes(normalized)) return "postgres";
    if (normalized === "planetscale") return "mysql";
    if (normalized === "jdbc") return "jdbc";
    return normalized as ConnectionDbType;
  }
  if (raw.startsWith("jdbc:")) {
    return "jdbc";
  }
  if (raw.startsWith("federated://")) {
    return "federated";
  }
  if (isLikelyTrinoHttpUrl(connectionString)) {
    return "trino";
  }
  if (
    raw.startsWith("trino://")
    || raw.startsWith("trino+http://")
    || raw.startsWith("trino+https://")
  ) {
    return "trino";
  }
  if (raw.startsWith("mssql://") || raw.startsWith("sqlserver://") || raw.startsWith("sqlserver:/")) {
    return "mssql";
  }
  if (raw.includes("server=") && (raw.includes("database=") || raw.includes("initial catalog="))) {
    return "mssql";
  }
  if (
    raw.startsWith("clickhouse://")
    || raw.startsWith("clickhouses://")
    || raw.startsWith("clickhouse+http://")
    || raw.startsWith("clickhouse+https://")
  ) {
    return "clickhouse";
  }
  if (raw.startsWith("redis://") || raw.startsWith("rediss://")) {
    return "redis";
  }
  if (raw.startsWith("mongodb://") || raw.startsWith("mongodb+srv://")) {
    return "mongodb";
  }
  if (isDuckdbConnectionString(connectionString)) {
    return "duckdb";
  }
  if (isMysqlConnectionString(connectionString)) {
    return "mysql";
  }
  if (isSqliteConnectionString(connectionString)) {
    return "sqlite";
  }
  return "postgres";
}

export function getMongoDatabaseFromConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(String(connectionString || "").trim());
    if (!/^mongodb(\+srv)?:$/i.test(parsed.protocol)) return "admin";
    const pathname = decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, "").trim());
    return pathname || "admin";
  } catch {
    return "admin";
  }
}
