export type SecretBearingConnection = {
  connectionString?: string;
  password?: string | null;
  authToken?: string | null;
};

const SECRET_QUERY_KEYS = /^(password|passwd|pwd|pass|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?(?:key|token)|apikey|secret|client[_-]?secret|private[_-]?key|bearer|credential)$/i;

const SECRET_REDACT_PATTERN = "password|passwd|pwd|pass|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?(?:key|token)|apikey|secret|client[_-]?secret|private[_-]?key|bearer|credential";

function splitQuery(value: string) {
  const hashAt = value.indexOf("#");
  const beforeHash = hashAt < 0 ? value : value.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : value.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  return queryAt < 0
    ? { base: beforeHash, hash, parts: [] as string[] }
    : { base: beforeHash.slice(0, queryAt), hash, parts: beforeHash.slice(queryAt + 1).split("&") };
}

function isSecretParameter(part: string) {
  const key = part.slice(0, part.indexOf("=") < 0 ? part.length : part.indexOf("="));
  try { return SECRET_QUERY_KEYS.test(decodeURIComponent(key)); }
  catch { return SECRET_QUERY_KEYS.test(key); }
}

export function stripConnectionSecrets(value: string): string {
  const jdbcPrefix = /^jdbc:/i.test(value) ? value.slice(0, 5) : "";
  const parseable = jdbcPrefix ? value.slice(5) : value;
  try {
    const url = new URL(parseable);
    url.password = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (SECRET_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    });
    const normalized = `${jdbcPrefix}${url.toString()}`;
    const querySecretPattern = new RegExp(`([;?&])(?:${SECRET_REDACT_PATTERN})=[^;&?#]*`, "gi");
    return normalized
      .replace(querySecretPattern, "")
      .replace(/(jdbc:oracle:thin:[^/]+)\/[^@]+(@)/i, "$1$2");
  } catch {
    const userInfoRedacted = value.replace(/(\/\/[^:/@]+):[^@/]+@/, "$1@");
    const { base, hash, parts } = splitQuery(userInfoRedacted);
    const safeParts = parts.filter((part) => !isSecretParameter(part));
    return `${base}${safeParts.length ? `?${safeParts.join("&")}` : ""}${hash}`
      .replace(new RegExp(`(;)(?:${SECRET_REDACT_PATTERN})=[^;&?#]*`, "gi"), "")
      .replace(/(jdbc:oracle:thin:[^/]+)\/[^@]+(@)/i, "$1$2");
  }
}

export function hasConnectionSecret(payload: SecretBearingConnection): boolean {
  if (payload.password || payload.authToken) return true;
  const value = payload.connectionString || "";
  if (/\/\/[^:/@]+:[^@/]+@/.test(value) || /jdbc:oracle:thin:[^/]+\/[^@]+@/i.test(value)) return true;
  if (value.split(";").slice(1).some(isSecretParameter)) return true;
  const parseable = value.replace(/^jdbc:/i, "");
  try {
    return [...new URL(parseable).searchParams.keys()].some((key) => SECRET_QUERY_KEYS.test(key));
  } catch {
    return splitQuery(value).parts.some(isSecretParameter);
  }
}

export function restorePostgresPassword(connectionString: string, username: string, password: string) {
  if (!password) return connectionString;
  const normalized = String(connectionString || "").trim().replace(
    /^((?:postgres(?:ql)?):)\/(?!\/)/i,
    "$1//",
  );
  if (!/^postgres(?:ql)?:\/\//i.test(normalized)) return connectionString;
  try {
    const url = new URL(normalized);
    if (!url.username && username) url.username = username;
    // URL setters percent-encode automatically, so raw values such as
    // `12345` or `p@ss` survive the round-trip.
    if (!url.password) url.password = password;
    return url.toString();
  } catch {
    return connectionString;
  }
}

// Query parameters that describe the local client setup rather than the
// remote target (driver resolution, etc.). They must not count as a target
// change when deciding whether a stored credential bundle still belongs to
// a saved connection string — e.g. the JDBC jarPaths self-heal rewrites the
// row without rotating the remote identity.
const INCIDENTAL_QUERY_KEYS = /^(jarPaths|driverClass)$/i;

// Well-known default ports per scheme, for comparison normalization.
const DEFAULT_SCHEME_PORTS: Record<string, string> = {
  postgresql: "5432",
  postgres: "5432",
  mysql: "3306",
  mariadb: "3306",
  mongodb: "27017",
  redis: "6379",
  rediss: "6379",
  sqlserver: "1433",
  mssql: "1433",
};

/**
 * Redacted connection target for stale-bundle comparison: strips incidental
 * client-side query parameters, then all secrets. Two strings that differ
 * only by password (or by jarPaths/driverClass) compare equal; a changed
 * host/database/user does not. Semantically identical representations
 * (parameter order, explicit default port) are normalized so cosmetic edits
 * don't force needless credential re-entry. Path characters are preserved
 * verbatim: PostgreSQL treats a trailing slash as part of the database
 * name, so `app/` and `app` are different targets.
 */
export function redactedTargetForComparison(value: string): string {
  const jdbcPrefix = /^jdbc:/i.test(value) ? value.slice(0, 5) : "";
  const parseable = jdbcPrefix ? value.slice(5) : value;
  let normalized = value;
  try {
    const url = new URL(parseable);
    for (const key of [...url.searchParams.keys()]) {
      if (INCIDENTAL_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();
    const defaultPort = DEFAULT_SCHEME_PORTS[scheme];
    if (defaultPort && url.port === defaultPort) url.port = "";
    normalized = `${jdbcPrefix}${url.toString()}`;
  } catch {
    normalized = value.replace(/([?&])(?:jarPaths|driverClass)=[^;&?#]*/gi, "$1");
  }
  return stripConnectionSecrets(normalized);
}

const INCIDENTAL_QUERY_KEY_LIST = ["jarPaths", "driverClass"] as const;

/**
 * Row-wins merge of incidental client-side query parameters (driver
 * settings) onto a stored bundle URL. When a user edits e.g. `jarPaths`
 * while leaving the password blank, the saved row carries the new settings
 * but the stored bundle still holds the old URL — replaying the bundle
 * verbatim would revert the edit on reload. Returns the bundle URL
 * unchanged when the incidental settings already match (or when either
 * side is not URL-parseable).
 */
export function applyRowDriverSettings(bundleUrl: string, rowUrl: string): string {
  const bundlePrefix = /^jdbc:/i.test(bundleUrl) ? bundleUrl.slice(0, 5) : "";
  let bundle: URL;
  let row: URL;
  try {
    bundle = new URL(bundlePrefix ? bundleUrl.slice(5) : bundleUrl);
    row = new URL(/^jdbc:/i.test(rowUrl) ? rowUrl.slice(5) : rowUrl);
  } catch {
    return bundleUrl;
  }
  let changed = false;
  for (const key of INCIDENTAL_QUERY_KEY_LIST) {
    const lower = key.toLowerCase();
    const rowEntry = [...row.searchParams.entries()].find(([k]) => k.toLowerCase() === lower);
    const bundleEntries = [...bundle.searchParams.entries()].filter(([k]) => k.toLowerCase() === lower);
    const same = rowEntry
      ? bundleEntries.length === 1 &&
        bundleEntries[0][0] === rowEntry[0] &&
        bundleEntries[0][1] === rowEntry[1]
      : bundleEntries.length === 0;
    if (same) continue;
    for (const [k] of bundleEntries) bundle.searchParams.delete(k);
    if (rowEntry) bundle.searchParams.append(rowEntry[0], rowEntry[1]);
    changed = true;
  }
  if (!changed) return bundleUrl;
  return `${bundlePrefix}${bundle.toString()}`;
}
