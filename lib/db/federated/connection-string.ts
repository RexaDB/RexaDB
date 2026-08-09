import type { FederatedConfig, FederatedSource } from "./types";

const FEDERATED_PREFIX = "federated://";

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function encodePayload(config: FederatedConfig) {
  return toBase64Url(JSON.stringify(config));
}

function decodePayload(payload: string) {
  return JSON.parse(fromBase64Url(payload));
}

function isFederatedConnectionString(connectionString: string) {
  return String(connectionString || "").trim().toLowerCase().startsWith(FEDERATED_PREFIX);
}

function normalizeFederatedSources(sources: FederatedSource[]) {
  return sources
    .map((source) => ({
      alias: String(source?.alias || "").trim(),
      connectionId: Number(source?.connectionId || 0),
      namespace: String(source?.namespace || "").trim() || undefined,
    }))
    .filter((source) => source.alias && Number.isInteger(source.connectionId) && source.connectionId > 0);
}

function validateFederatedConfig(config: FederatedConfig) {
  const sources = normalizeFederatedSources(config.sources);
  if (sources.length === 0) throw new Error("Federated connections require at least one mapped source.");
  const aliases = new Set<string>();
  for (const source of sources) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(source.alias)) {
      throw new Error(`Invalid federated alias "${source.alias}". Use letters, numbers, and underscores only.`);
    }
    if (aliases.has(source.alias)) throw new Error(`Duplicate federated alias "${source.alias}".`);
    aliases.add(source.alias);
  }
  return { version: 1 as const, sources };
}

export function buildFederatedConnectionString(config: FederatedConfig) {
  return `${FEDERATED_PREFIX}${encodePayload(validateFederatedConfig(config))}`;
}

export function parseFederatedConnectionString(connectionString: string): FederatedConfig {
  const raw = String(connectionString || "").trim();
  if (!isFederatedConnectionString(raw)) throw new Error("Invalid federated connection string.");
  const config = decodePayload(raw.slice(FEDERATED_PREFIX.length));
  return validateFederatedConfig({
    version: 1,
    sources: Array.isArray(config?.sources) ? config.sources : [],
  });
}
