// Oracle connection URL helpers.
//
// Service Name (default):
//   oracle://user:pass@host:1521/SERVICE?sslmode=disable
// SID:
//   oracle://user:pass@host:1521/?sid=ORCL&sslmode=disable
//
// Service Name and SID are mutually exclusive.

export type OracleConnectMode = "service" | "sid";

export type OracleConnectionParts = {
  host: string;
  port: string;
  username: string;
  password: string;
  connectMode: OracleConnectMode;
  /** Service name or SID value (exactly one, based on connectMode). */
  target: string;
  sslMode: string;
};

const DEFAULTS: OracleConnectionParts = {
  host: "localhost",
  port: "1521",
  username: "",
  password: "",
  connectMode: "service",
  target: "",
  sslMode: "disable",
};

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

export function emptyOracleParts(): OracleConnectionParts {
  return { ...DEFAULTS };
}

export function isOracleConnectionString(connectionString: string): boolean {
  const raw = String(connectionString || "").trim().toLowerCase();
  return raw.startsWith("oracle://") || raw.startsWith("oracle:");
}

export function parseOracleConnectionString(
  connectionString: string,
): OracleConnectionParts {
  const trimmed = String(connectionString || "").trim();
  if (!trimmed) return emptyOracleParts();

  try {
    const parseable = trimmed.replace(/^oracle:/i, "http:");
    const parsed = new URL(parseable);
    const sid = String(parsed.searchParams.get("sid") || "").trim();
    const pathTarget = decode(String(parsed.pathname || "").replace(/^\/+/, "").trim());
    const connectMode: OracleConnectMode = sid ? "sid" : "service";
    const target = connectMode === "sid" ? sid : pathTarget;
    const sslMode = String(
      parsed.searchParams.get("sslmode") ||
        parsed.searchParams.get("ssl") ||
        DEFAULTS.sslMode,
    )
      .toLowerCase()
      .trim() || DEFAULTS.sslMode;

    return {
      host: parsed.hostname || DEFAULTS.host,
      port: parsed.port || DEFAULTS.port,
      username: decode(parsed.username || ""),
      password: decode(parsed.password || ""),
      connectMode,
      target,
      sslMode,
    };
  } catch {
    return emptyOracleParts();
  }
}

export function buildOracleConnectionString(
  parts: Partial<OracleConnectionParts>,
): string {
  const host = String(parts.host || "").trim() || DEFAULTS.host;
  const port = String(parts.port || "").trim() || DEFAULTS.port;
  const username = String(parts.username || "").trim();
  const password = String(parts.password || "");
  const connectMode: OracleConnectMode =
    parts.connectMode === "sid" ? "sid" : "service";
  const target = String(parts.target || "").trim();
  const sslMode = String(parts.sslMode || DEFAULTS.sslMode)
    .toLowerCase()
    .trim() || DEFAULTS.sslMode;

  const auth = username
    ? `${encode(username)}${password ? `:${encode(password)}` : ""}@`
    : "";

  const params = new URLSearchParams();
  params.set("sslmode", sslMode);

  if (connectMode === "sid") {
    if (target) params.set("sid", target);
    return `oracle://${auth}${host}:${port}/?${params.toString()}`;
  }

  const pathname = target ? `/${encode(target)}` : "/";
  return `oracle://${auth}${host}:${port}${pathname}?${params.toString()}`;
}

/**
 * Build the Oracle Net connect string passed to the Rust thin driver.
 * Service Name → Easy Connect. SID → connect descriptor.
 */
const DESCRIPTOR_TARGET_RE = /^[A-Za-z0-9_.\-#$]+$/;
const DESCRIPTOR_HOST_RE = /^[A-Za-z0-9_.\-:$[\]]+$/;
const DESCRIPTOR_PORT_RE = /^\d+$/;

function assertDescriptorValue(value: string, label: string, re: RegExp): string {
  // The TNS descriptor is string-interpolated, so reject anything outside
  // the characters Oracle naming allows. A `)` or `(` in the service
  // name / SID would otherwise break out of CONNECT_DATA and rewrite the
  // descriptor (e.g. redirect HOST) — fail closed instead.
  if (!re.test(value)) {
    throw new Error(`Invalid Oracle ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

export function buildOracleNetConnectString(parts: OracleConnectionParts): string {
  const host = assertDescriptorValue(
    parts.host.trim() || "localhost",
    "host",
    DESCRIPTOR_HOST_RE,
  );
  const port = assertDescriptorValue(
    parts.port.trim() || "1521",
    "port",
    DESCRIPTOR_PORT_RE,
  );
  const target = parts.target.trim();
  const sslEnabled =
    parts.sslMode &&
    !["disable", "false", "off", "0"].includes(parts.sslMode.toLowerCase());
  const protocol = sslEnabled ? "tcps" : "tcp";

  if (parts.connectMode === "sid") {
    if (!target) {
      throw new Error("Oracle SID is required when connect mode is SID.");
    }
    assertDescriptorValue(target, "SID", DESCRIPTOR_TARGET_RE);
    return (
      `(DESCRIPTION=(ADDRESS=(PROTOCOL=${protocol})(HOST=${host})(PORT=${port}))` +
      `(CONNECT_DATA=(SID=${target})))`
    );
  }

  if (!target) {
    throw new Error("Oracle service name is required when connect mode is Service Name.");
  }
  assertDescriptorValue(target, "service name", DESCRIPTOR_TARGET_RE);
  if (sslEnabled) {
    return `${protocol}://${host}:${port}/${target}`;
  }
  return `${host}:${port}/${target}`;
}

export function oraclePartsToBridgeConfig(parts: OracleConnectionParts): {
  connectString: string;
  username: string;
  password: string;
} {
  return {
    connectString: buildOracleNetConnectString(parts),
    username: parts.username,
    password: parts.password,
  };
}
