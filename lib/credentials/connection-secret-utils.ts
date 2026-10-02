export type SecretBearingConnection = {
  connectionString?: string;
  password?: string | null;
  authToken?: string | null;
};

const SECRET_QUERY_KEYS = /^(password|passwd|pwd|pass|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?(?:key|token)|apikey|secret|client[_-]?secret|private[_-]?key|bearer|credential)$/i;

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
    return normalized
      .replace(/([;?&])(?:password|passwd|pwd|pass|token|auth_token|access_token|refresh_token|api_key|api_token|secret|client_secret|private_key|bearer|credential)=[^;&?#]*/gi, "")
      .replace(/(jdbc:oracle:thin:[^/]+)\/[^@]+(@)/i, "$1$2");
  } catch {
    const userInfoRedacted = value.replace(/(\/\/[^:/@]+):[^@/]+@/, "$1@");
    const { base, hash, parts } = splitQuery(userInfoRedacted);
    const safeParts = parts.filter((part) => !isSecretParameter(part));
    return `${base}${safeParts.length ? `?${safeParts.join("&")}` : ""}${hash}`
      .replace(/(;)(?:password|passwd|pwd|pass|token|auth_token|access_token|refresh_token|api_key|api_token|secret|client_secret|private_key|bearer|credential)=[^;&?#]*/gi, "")
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
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString) || !password) return connectionString;
  try {
    const url = new URL(connectionString);
    if (!url.username && username) url.username = username;
    if (!url.password) url.password = password;
    return url.toString();
  } catch {
    return connectionString;
  }
}
