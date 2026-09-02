// Shared helpers for editing connections via individual fields (host, port,
// database, username, password, ssl) instead of a hand-assembled URI.

export type ConnectionFieldValues = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslMode: string;
  authToken: string;
  protocol: string;
};

export type PlanetScaleProtocol = "mysql" | "postgresql";

export type FieldProviderId =
  | "timescale"
  | "supabase"
  | "neon"
  | "planetscale"
  | "cockroachdb"
  | "yugabytedb"
  | "redshift"
  | "mongodb"
  | "mysql"
  | "mariadb"
  | "mssql"
  | "clickhouse"
  | "redis";

export const FIELD_BASED_PROVIDERS: FieldProviderId[] = [
  "timescale",
  "supabase",
  "neon",
  "planetscale",
  "cockroachdb",
  "yugabytedb",
  "redshift",
  "mongodb",
  "mysql",
  "mariadb",
  "mssql",
  "clickhouse",
  "redis",
];

export function isFieldBasedProvider(provider: string | null | undefined) {
  return (
    provider != null &&
    (FIELD_BASED_PROVIDERS as string[]).includes(provider)
  );
}

type ProviderDefaults = {
  scheme: string;
  port: string;
  username: string;
  sslMode: string;
  hosted: boolean;
  usesDatabasePath: boolean;
  protocol?: PlanetScaleProtocol;
};

export function getProviderFieldDefaults(
  provider: FieldProviderId,
): ProviderDefaults {
  switch (provider) {
    case "timescale":
      return { scheme: "postgresql", port: "5432", username: "postgres", sslMode: "prefer", hosted: false, usesDatabasePath: true };
    case "supabase":
      return { scheme: "postgresql", port: "5432", username: "postgres", sslMode: "require", hosted: true, usesDatabasePath: true };
    case "neon":
      return { scheme: "postgresql", port: "5432", username: "postgres", sslMode: "require", hosted: true, usesDatabasePath: true };
    case "planetscale":
      return { scheme: "postgresql", port: "5432", username: "root", sslMode: "require", hosted: true, usesDatabasePath: true, protocol: "postgresql" };
    case "cockroachdb":
      return { scheme: "postgresql", port: "26257", username: "root", sslMode: "verify-full", hosted: true, usesDatabasePath: true };
    case "yugabytedb":
      return { scheme: "postgresql", port: "5433", username: "yugabyte", sslMode: "require", hosted: true, usesDatabasePath: true };
    case "redshift":
      return { scheme: "postgresql", port: "5439", username: "awsuser", sslMode: "require", hosted: true, usesDatabasePath: true };
    case "mysql":
      return { scheme: "mysql", port: "3306", username: "root", sslMode: "disable", hosted: false, usesDatabasePath: true };
    case "mariadb":
      return { scheme: "mariadb", port: "3306", username: "root", sslMode: "disable", hosted: false, usesDatabasePath: true };
    case "mssql":
      return { scheme: "mssql", port: "1433", username: "sa", sslMode: "disable", hosted: false, usesDatabasePath: true };
    case "clickhouse":
      return { scheme: "clickhouse", port: "8123", username: "default", sslMode: "disable", hosted: false, usesDatabasePath: true };
    case "mongodb":
      return { scheme: "mongodb", port: "27017", username: "", sslMode: "disable", hosted: false, usesDatabasePath: true };
    case "redis":
      return { scheme: "redis", port: "6379", username: "", sslMode: "disable", hosted: false, usesDatabasePath: false };
    default:
      return { scheme: "postgresql", port: "5432", username: "postgres", sslMode: "prefer", hosted: false, usesDatabasePath: true };
  }
}

export function emptyFieldValues(provider: FieldProviderId): ConnectionFieldValues {
  const defaults = getProviderFieldDefaults(provider);
  return {
    host: "localhost",
    port: defaults.port,
    database: "",
    username: defaults.username,
    password: "",
    sslMode: defaults.sslMode,
    authToken: "",
    protocol: defaults.protocol ?? "postgresql",
  };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encode(value: string): string {
  if (!value) return "";
  return encodeURIComponent(value);
}

function buildAuth(username: string, password: string): string {
  if (!username) return "";
  return `${encode(username)}${password ? `:${encode(password)}` : ""}@`;
}

function isPostgresFamily(provider: FieldProviderId): boolean {
  return (
    provider === "timescale" ||
    provider === "supabase" ||
    provider === "neon" ||
    provider === "planetscale" ||
    provider === "cockroachdb" ||
    provider === "yugabytedb" ||
    provider === "redshift"
  );
}

export function buildConnectionStringFromFields(
  provider: FieldProviderId,
  fields: Partial<ConnectionFieldValues>,
): string {
  const defaults = getProviderFieldDefaults(provider);
  const host = String(fields.host || "").trim() || "localhost";
  const port = String(fields.port || "").trim() || defaults.port;
  const database = String(fields.database || "").trim();
  const username = String(fields.username || "").trim();
  const password = String(fields.password || "");
  const sslMode = String(fields.sslMode || defaults.sslMode)
    .toLowerCase()
    .trim();
  const auth = buildAuth(username, password);
  const pathname = database ? `/${encode(database)}` : "";

  if (provider === "planetscale" && (fields.protocol ?? "postgresql") === "mysql") {
    const connectionPort = port === defaults.port && defaults.port === "5432" ? "3306" : port;
    const params = new URLSearchParams();
    params.set("sslmode", "require");
    return `mysql://${auth}${host}:${connectionPort}${pathname}?${params.toString()}`;
  }

  if (isPostgresFamily(provider)) {
    const params = new URLSearchParams();
    params.set("sslmode", sslMode);
    return `postgresql://${auth}${host}:${port}${pathname}?${params.toString()}`;
  }

  if (provider === "mysql" || provider === "mariadb") {
    const sslEnabled =
      sslMode && !["disable", "false", "off", "0"].includes(sslMode);
    const params = new URLSearchParams();
    if (sslEnabled) params.set("sslmode", "require");
    const query = params.toString();
    return `${defaults.scheme}://${auth}${host}:${port}${pathname}${query ? `?${query}` : ""}`;
  }

  if (provider === "mssql") {
    const sslEnabled =
      sslMode && !["disable", "false", "off", "0"].includes(sslMode);
    const params = new URLSearchParams();
    params.set("encrypt", sslEnabled ? "true" : "false");
    if (sslEnabled && sslMode !== "verify-full") {
      params.set("trustServerCertificate", "true");
    }
    return `mssql://${auth}${host}:${port}${pathname}?${params.toString()}`;
  }

  if (provider === "clickhouse") {
    const sslEnabled =
      sslMode && !["disable", "false", "off", "0"].includes(sslMode);
    const scheme = sslEnabled ? "clickhouses" : "clickhouse";
    return `${scheme}://${auth}${host}:${port}${pathname}`;
  }

  if (provider === "mongodb") {
    const sslEnabled =
      sslMode && !["disable", "false", "off", "0"].includes(sslMode);
    const isSrvHost = /\.mongodb\.net$/i.test(host) || host.includes(".mongodb.net");
    if (sslEnabled && isSrvHost) {
      return `mongodb+srv://${auth}${host}${pathname}`;
    }
    const query = sslEnabled ? "?tls=true" : "";
    return `mongodb://${auth}${host}:${port}${pathname}${query}`;
  }

  if (provider === "redis") {
    const sslEnabled =
      sslMode && !["disable", "false", "off", "0"].includes(sslMode);
    const scheme = sslEnabled ? "rediss" : "redis";
    const dbIndex = database || "0";
    return `${scheme}://${auth}${host}:${port}/${encode(dbIndex)}`;
  }

  return `${defaults.scheme}://${auth}${host}:${port}${pathname}`;
}

function parseGenericConnectionString(
  provider: FieldProviderId,
  connectionString: string,
): ConnectionFieldValues {
  const defaultsValue = emptyFieldValues(provider);
  const trimmed = String(connectionString || "").trim();
  if (!trimmed) return defaultsValue;

  let parseable = trimmed;
  const isPostgres = isPostgresFamily(provider);
  if (isPostgres) {
    parseable = trimmed.replace(/^postgres(?:ql)?:\/(?!\/)/i, "http://");
    parseable = parseable.replace(/^postgres(?:ql)?:\/\//i, "http://");
  } else if (provider === "clickhouse") {
    parseable = trimmed
      .replace(/^clickhouses:\/\//i, "https://")
      .replace(/^clickhouse:\/\//i, "http://");
  }

  try {
    const parsed = new URL(parseable);
    const host = parsed.hostname || "localhost";
    let port = parsed.port || "";

    let database = decode(String(parsed.pathname || "").replace(/^\/+/, ""));
    if (provider === "redis" && !database) database = "0";

    let protocol = defaultsValue.protocol;
    if (provider === "planetscale") {
      if (/^mysql:/i.test(trimmed)) protocol = "mysql";
      else if (/^postgres(?:ql)?:/i.test(trimmed)) protocol = "postgresql";
      if (!port) port = protocol === "mysql" ? "3306" : "5432";
    }

    let sslMode = defaultsValue.sslMode;
    if (isPostgres) {
      const raw = String(parsed.searchParams.get("sslmode") || "").toLowerCase();
      if (raw) sslMode = raw;
    } else if (provider === "clickhouse") {
      const raw = String(parsed.protocol || "");
      sslMode =
        raw.startsWith("https") || /^clickhouses:/i.test(trimmed)
          ? "require"
          : "disable";
    } else if (provider === "mongodb") {
      const tls = parsed.searchParams.get("tls");
      sslMode =
        /^mongodb\+srv:/i.test(trimmed) ||
        tls === "true" ||
        tls === "1" ||
        parsed.searchParams.get("ssl") === "true"
          ? "require"
          : "disable";
    } else if (provider === "redis") {
      sslMode = /^rediss:/i.test(trimmed) ? "require" : "disable";
    } else if (provider === "mssql") {
      const encrypt = String(
        parsed.searchParams.get("encrypt") ||
          parsed.searchParams.get("ssl") ||
          "",
      ).toLowerCase();
      sslMode =
        encrypt && !["false", "0", "no", "off"].includes(encrypt)
          ? "require"
          : "disable";
    } else if (provider === "mysql" || provider === "mariadb") {
      const raw = String(
        parsed.searchParams.get("sslmode") ||
          parsed.searchParams.get("ssl") ||
          "",
      ).toLowerCase();
      sslMode =
        raw && !["disable", "false", "0", "off"].includes(raw)
          ? "require"
          : "disable";
    }

    return {
      host,
      port,
      database,
      username: decode(parsed.username || "") || defaultsValue.username,
      password: decode(parsed.password || ""),
      sslMode,
      authToken:
        parsed.searchParams.get("authToken") ||
        parsed.searchParams.get("auth_token") ||
        parsed.searchParams.get("token") ||
        "",
      protocol,
    };
  } catch {
    return defaultsValue;
  }
}

export function parseFieldsFromConnectionString(
  provider: FieldProviderId,
  connectionString: string,
): ConnectionFieldValues {
  return parseGenericConnectionString(provider, connectionString);
}

export function sslModeOptionsForProvider(
  provider: FieldProviderId,
  protocol?: string,
): Array<{
  value: string;
  label: string;
}> {
  if ((provider === "planetscale" && protocol === "mysql") || provider === "mysql" || provider === "mariadb") {
    return [
      { value: "disable", label: "Disabled" },
      { value: "require", label: "Require" },
    ];
  }
  if (isPostgresFamily(provider)) {
    return [
      { value: "disable", label: "Disabled" },
      { value: "prefer", label: "Prefer" },
      { value: "require", label: "Require" },
      { value: "verify-ca", label: "Verify CA" },
      { value: "verify-full", label: "Verify Full" },
    ];
  }
  if (provider === "clickhouse") {
    return [
      { value: "disable", label: "Disabled (HTTP)" },
      { value: "require", label: "Enabled (HTTPS)" },
    ];
  }
  return [
    { value: "disable", label: "Disabled" },
    { value: "require", label: "Require" },
  ];
}