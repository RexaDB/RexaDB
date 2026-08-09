import { detectConnectionDbType } from "@/lib/db/connection-type";
import { getFederatedDefaultNamespace } from "@/lib/db/federated/default-namespace";
import type { Connection } from "@/lib/db/schema";
import type { FederatedDraft } from "./federated-connection-types";

const FEDERATED_SQL_TYPES = new Set(["postgres", "sqlite", "mysql"]);

export function sanitizeFederatedAlias(value: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^[^a-zA-Z_]+/, "")
    .replace(/_+/g, "_");
  return normalized || "source";
}

function getNextFederatedAlias(name: string, drafts: FederatedDraft[], index: number) {
  const base = sanitizeFederatedAlias(name);
  const used = new Set(drafts.filter((_, rowIndex) => rowIndex !== index).map((draft) => draft.alias));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function getFederatedDraftError(draft: FederatedDraft) {
  if (!draft.connectionId) return "Select a connection.";
  if (!draft.alias.trim()) return "Alias is required.";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(draft.alias.trim())) {
    return "Alias must start with a letter or underscore and use only letters, numbers, and underscores.";
  }
  return "";
}

export function isFederatedSupportedConnection(connection: Connection) {
  return FEDERATED_SQL_TYPES.has(detectConnectionDbType(connection.connectionString));
}

export function getFederatedConnectionLabel(connectionString: string) {
  const dbType = detectConnectionDbType(connectionString);
  if (dbType === "sqlite") {
    const normalized = String(connectionString || "").trim().toLowerCase();
    return normalized.startsWith("libsql://") ? "libsql" : "sqlite";
  }
  return dbType;
}

export function isFederatedConnectionSelected(connectionId: number, drafts: FederatedDraft[]) {
  return drafts.some((draft) => draft.connectionId === connectionId);
}

function toggleFederatedConnection(connection: Connection, drafts: FederatedDraft[]) {
  const existingIndex = drafts.findIndex((draft) => draft.connectionId === connection.id);
  if (existingIndex >= 0) {
    return drafts.filter((draft) => draft.connectionId !== connection.id);
  }
  return [
    ...drafts,
    {
      alias: getNextFederatedAlias(connection.name, drafts, drafts.length),
      connectionId: connection.id,
      namespace: getFederatedDefaultNamespace(connection.connectionString),
    },
  ];
}

export function setFederatedConnectionChecked(connection: Connection, drafts: FederatedDraft[], checked: boolean) {
  const isSelected = isFederatedConnectionSelected(connection.id, drafts);
  if (checked === isSelected) return drafts;
  return toggleFederatedConnection(connection, drafts);
}
