import type { ConnectionDbType } from "@/lib/db/connection-type";

export function getEditorLabel(dbType: ConnectionDbType): string {
  if (dbType === "mongodb") return "Query Editor";
  if (dbType === "redis") return "Command Editor";
  return "SQL Editor";
}

export function getEditorBadge(dbType: ConnectionDbType): string {
  if (dbType === "mongodb") return "MONGO SHELL";
  if (dbType === "redis") return "CMD";
  if (dbType === "spacetimedb") return "SPACETIME";
  return "SQL";
}

export function getTableLabels(dbType: ConnectionDbType): { singular: string; plural: string } {
  if (dbType === "mongodb") return { singular: "Collection", plural: "Collections" };
  if (dbType === "redis") return { singular: "Key", plural: "Keys" };
  return { singular: "Table", plural: "Tables" };
}
