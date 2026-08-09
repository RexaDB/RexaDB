import { detectConnectionDbType } from "./connection-type";

export function normalizePgConnectionString(connectionString: string): string {
  const input = String(connectionString || "").trim();
  if (/^postgres(?:ql)?:\/(?!\/)/i.test(input)) {
    return input.replace(/^((?:postgres(?:ql)?):)\/(?!\/)/i, "$1//");
  }
  return input;
}

function decodePgCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getPgPassword(connectionString: string): string {
  try {
    const parsed = new URL(normalizePgConnectionString(connectionString));
    return decodePgCredential(parsed.password || "");
  } catch {
    return "";
  }
}

export function getPgUsername(connectionString: string): string {
  try {
    const parsed = new URL(normalizePgConnectionString(connectionString));
    return decodePgCredential(parsed.username || "");
  } catch {
    return "";
  }
}

export function getPgDatabase(connectionString: string): string {
  try {
    const parsed = new URL(normalizePgConnectionString(connectionString));
    return decodePgCredential(String(parsed.pathname || "").replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

export function getPgHost(connectionString: string): string {
  try {
    return new URL(normalizePgConnectionString(connectionString)).hostname || "localhost";
  } catch {
    return "localhost";
  }
}

export function getPgPort(connectionString: string): number {
  try {
    const raw = new URL(normalizePgConnectionString(connectionString)).port;
    const parsed = Number(raw || "5432");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5432;
  } catch {
    return 5432;
  }
}

export function getPgSslConfig(connectionString: string) {
  try {
    const parsed = new URL(normalizePgConnectionString(connectionString));
    const rawSslMode = String(parsed.searchParams.get("sslmode") || "prefer").toLowerCase();
    const sslMode = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(rawSslMode)
      ? rawSslMode
      : "prefer";
    if (sslMode === "disable") return false;
    if (sslMode === "verify-full" || sslMode === "verify-ca") {
      return { rejectUnauthorized: true };
    }
    return { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

export function recoverPgCredentials(params: {
  password: string;
  database: string;
  username: string;
  host: string;
  port: number;
}): { username: string; password: string; host: string; port: number; database: string } {
  let { password, database, username, host, port } = params;
  if (
    password === "" &&
    database &&
    /^([^:/]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/.test(database)
  ) {
    const m = database.match(/^([^:/]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/);
    if (m) {
      username = decodePgCredential(m[1] || "");
      password = decodePgCredential(m[2] || "");
      host = m[3] || host;
      const recoveredPort = Number(m[4] || "5432");
      port = Number.isFinite(recoveredPort) && recoveredPort > 0 ? recoveredPort : port;
      database = decodePgCredential(m[5] || "");
    }
  }
  return { username, password, host, port, database };
}

export function validateSslMode(raw: string, defaultMode = "prefer"): string {
  const mode = String(raw).toLowerCase();
  return ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(mode)
    ? mode
    : defaultMode;
}

export function isPostgresConnection(connectionString: string) {
  return detectConnectionDbType(connectionString) === "postgres";
}
