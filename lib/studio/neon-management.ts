import { isNeonCliConnectionString, parseNeonCliConnectionString } from "@/lib/neon-cli/pointer";

export function getNeonManagementPointer(connectionString?: string) {
  if (!connectionString || !isNeonCliConnectionString(connectionString)) return null;
  return parseNeonCliConnectionString(connectionString);
}

export function isNeonManagementConnection(connectionType?: string, connectionString?: string) {
  return connectionType === "neon" && getNeonManagementPointer(connectionString) !== null;
}
