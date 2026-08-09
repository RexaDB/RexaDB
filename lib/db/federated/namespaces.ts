import type { FederatedSource } from "./types";

export function getFederatedNamespaces(sources: Array<FederatedSource & { connectionString?: string }>) {
  return Object.fromEntries(sources.map((source) => [source.alias, source.namespace || ""]));
}
