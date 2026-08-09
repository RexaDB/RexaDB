import { detectConnectionDbType, getMongoDatabaseFromConnectionString } from "@/lib/db/connection-type";
import { getRedisDbLabel, updateRedisConnectionStringDatabase } from "@/lib/db/redis-utils";
import { normalizePgConnectionString } from "@/lib/db/pg-connection";
function getDbNameFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").trim());
    if (dbName && !dbName.includes("@") && !dbName.includes(":")) return dbName;
  } catch {}
  return null;
}

export function getDatabaseFromConnectionString(connectionString: string) {
  if (!connectionString) return "postgres";
  if (connectionString.startsWith("workspace:")) return "";
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "mongodb") {
    return getMongoDatabaseFromConnectionString(connectionString);
  }
  if (dbType === "redis") {
    return getRedisDbLabel(connectionString);
  }
  if (dbType === "federated") {
    return "federated";
  }
  if (dbType === "trino") {
    try {
      const parsed = new URL(connectionString);
      return parsed.searchParams.get("schema") || "default";
    } catch {
      return "default";
    }
  }
  if (dbType === "supabase-mgmt") {
    try {
      const parsed = new URL(connectionString);
      return parsed.hostname || "supabase";
    } catch {
      return "supabase";
    }
  }
  if (dbType === "mssql") {
    try {
      if (connectionString.includes(";")) {
        const parts = connectionString.split(";").map((p) => p.trim()).filter(Boolean);
        for (const part of parts) {
          const [rawKey, ...rest] = part.split("=");
          const key = rawKey?.trim().toLowerCase();
          const value = rest.join("=").trim();
          if (!key || !value) continue;
          if (key === "database" || key === "initial catalog") return value;
        }
      }
      const normalized = connectionString.replace(/^sqlserver:/i, "mssql:");
      const dbName = getDbNameFromUrl(normalized);
      if (dbName) return dbName;
    } catch {
      return "master";
    }
  }
  if (dbType === "mysql") {
    try {
      const normalized = /^(mysql|mariadb):\/(?!\/)/i.test(connectionString)
        ? connectionString.replace(/^((?:mysql|mariadb):)\/(?!\/)/i, "$1//")
        : (connectionString.includes("://") ? connectionString : `mysql://${connectionString}`);
      const dbName = getDbNameFromUrl(normalized);
      if (dbName) return dbName;
    } catch {
      return "mysql";
    }
  }
  if (dbType === "clickhouse") {
    try {
      const normalized = /^(clickhouse|clickhouses|clickhouse\\+http|clickhouse\\+https):\/\//i.test(connectionString)
        ? connectionString
          .replace(/^clickhouse\\+http:/i, "http:")
          .replace(/^clickhouse\\+https:/i, "https:")
          .replace(/^clickhouse:/i, "http:")
          .replace(/^clickhouses:/i, "https:")
        : connectionString;
      const dbName = getDbNameFromUrl(normalized);
      if (dbName) return dbName;
    } catch {
      return "default";
    }
  }
  if (dbType === "sqlite") {
    if (connectionString.trim() === ":memory:") return ":memory:";
    if (connectionString.trim().toLowerCase().startsWith("libsql://")) {
      try {
        const parsed = new URL(connectionString.trim());
        const nameFromPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").trim());
        return nameFromPath || parsed.hostname || "turso";
      } catch {
        return "turso";
      }
    }
    const raw = connectionString.split("?")[0].split("#")[0].trim();
    const normalized = raw.replace(/^sqlite:\/*/i, "").replace(/^file:\/*/i, "");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || "sqlite";
  }
  const dbName = getDbNameFromUrl(connectionString);
  if (dbName) return dbName;

  const withoutQuery = connectionString.split("?")[0].split("#")[0];
  const dbCandidate = decodeURIComponent(withoutQuery.split("/").pop()?.trim() || "");
  if (dbCandidate && !dbCandidate.includes("@") && !dbCandidate.includes(":")) return dbCandidate;

  if (dbType === "mysql") return "mysql";
  if (dbType === "mssql") return "master";
  if (dbType === "clickhouse") return "default";
  return "postgres";
}

export function updateConnectionStringDatabase(connectionString: string, newDatabase: string) {
  if (connectionString.startsWith("workspace:")) return connectionString;
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "sqlite" || dbType === "trino" || dbType === "spacetimedb" || dbType === "supabase-mgmt") {
    return connectionString;
  }
  if (dbType === "redis") {
    return updateRedisConnectionStringDatabase(connectionString, newDatabase);
  }
  if (dbType === "mssql" && connectionString.includes(";")) {
    const parts = connectionString.split(";").map((p) => p.trim()).filter(Boolean);
    let replaced = false;
    const updated = parts.map((part) => {
      const [rawKey, ...rest] = part.split("=");
      const key = rawKey?.trim().toLowerCase();
      if (key === "database" || key === "initial catalog") {
        replaced = true;
        return `${rawKey}=${newDatabase}`;
      }
      return part;
    });
    if (!replaced) {
      updated.push(`Database=${newDatabase}`);
    }
    return updated.join(";");
  }

  try {
    const normalized = dbType === "postgres" ? normalizePgConnectionString(connectionString) : connectionString;
    const url = new URL(normalized);
    
    // 1. Update the pathname
    url.pathname = `/${newDatabase}`;
    
    // 2. Aggressively update or add all common database parameters
    const dbParams = ["dbname", "database", "db"];
    dbParams.forEach(p => {
      url.searchParams.set(p, newDatabase);
    });
    
    // 3. Special handling for Supabase/PGBouncer which might use a 'options' param with -c dbname=...
    const options = url.searchParams.get("options");
    if (options && options.includes("dbname=")) {
      const updatedOptions = options.replace(/dbname=[^ ]+/, `dbname=${newDatabase}`);
      url.searchParams.set("options", updatedOptions);
    }

    return url.toString();
  } catch (e) {
    return connectionString;
  }
}

export function getDefaultNewTableColumns(dbType: "postgres" | "mongodb" | "sqlite" | "mysql" | "clickhouse" | "mssql" | "redis" | "trino" | "duckdb" | "federated" | "spacetimedb" | "jdbc" | "supabase-mgmt") {
  if (dbType === "redis" || dbType === "jdbc") {
    return [];
  }
  if (dbType === "federated") {
    return [];
  }
  if (dbType === "sqlite") {
    return [
      { name: "id", type: "INTEGER", isPrimary: true, isNullable: false, isUnique: false, default: "" },
      { name: "created_at", type: "TEXT", isPrimary: false, isNullable: false, isUnique: false, default: "CURRENT_TIMESTAMP" },
    ];
  }
  if (dbType === "mssql") {
    return [
      { name: "id", type: "INT", isPrimary: true, isNullable: false, isUnique: false, default: "IDENTITY(1,1)" },
      { name: "created_at", type: "DATETIME2", isPrimary: false, isNullable: false, isUnique: false, default: "SYSUTCDATETIME()" },
    ];
  }
  if (dbType === "mysql") {
    return [
      { name: "id", type: "INT", isPrimary: true, isNullable: false, isUnique: false, default: "AUTO_INCREMENT" },
      { name: "created_at", type: "TIMESTAMP", isPrimary: false, isNullable: false, isUnique: false, default: "CURRENT_TIMESTAMP" },
    ];
  }
  if (dbType === "clickhouse") {
    return [
      { name: "id", type: "UInt64", isPrimary: false, isNullable: false, isUnique: false, default: "" },
      { name: "created_at", type: "DateTime", isPrimary: false, isNullable: false, isUnique: false, default: "now()" },
    ];
  }
  if (dbType === "spacetimedb") {
    return [
      { name: "id", type: "U64", isPrimary: true, isNullable: false, isUnique: false, default: "" },
      { name: "name", type: "String", isPrimary: false, isNullable: false, isUnique: false, default: "" },
      { name: "created_at", type: "Timestamp", isPrimary: false, isNullable: false, isUnique: false, default: "" },
    ];
  }
  return [
    { name: "id", type: "SERIAL", isPrimary: true, isNullable: false, isUnique: false, default: "" },
    { name: "created_at", type: "TIMESTAMPTZ", isPrimary: false, isNullable: false, isUnique: false, default: "NOW()" },
  ];
}
