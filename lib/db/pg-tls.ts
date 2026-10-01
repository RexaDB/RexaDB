import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

// utils
import { getPgSslMode, normalizePgConnectionString } from "./pg-connection";

export function getPgTlsConfig(connectionString: string): false | ConnectionOptions {
  const mode = getPgSslMode(connectionString);
  if (mode === "disable") return false;

  const parameters = new URL(normalizePgConnectionString(connectionString)).searchParams;
  const ssl: ConnectionOptions = {
    rejectUnauthorized: mode === "verify-ca" || mode === "verify-full",
  };
  const ca = parameters.get("sslrootcert");
  const cert = parameters.get("sslcert");
  const key = parameters.get("sslkey");
  if (ca) ssl.ca = readFileSync(ca, "utf8");
  if (cert) ssl.cert = readFileSync(cert, "utf8");
  if (key) ssl.key = readFileSync(key, "utf8");
  if (mode === "verify-ca") ssl.checkServerIdentity = () => undefined;
  return ssl;
}

export function getPgClientConfig(connectionString: string) {
  const ssl = getPgTlsConfig(connectionString);
  const parsed = new URL(normalizePgConnectionString(connectionString));
  // node-postgres lets ssl parameters in the url override the explicit tls configuration.
  for (const parameter of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    parsed.searchParams.delete(parameter);
  }
  return { connectionString: parsed.toString(), ssl };
}
