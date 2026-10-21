import { isNeonCliConnectionString, parseNeonCliConnectionString } from "@/lib/neon-cli/pointer";

export function getNeonManagementPointer(connectionString?: string) {
  if (!connectionString || !isNeonCliConnectionString(connectionString)) return null;
  return parseNeonCliConnectionString(connectionString);
}

export function isNeonManagementConnection(connectionType?: string, connectionString?: string) {
  return connectionType?.toLowerCase() === "neon" && getNeonManagementPointer(connectionString) !== null;
}

export function isNeonDatabaseConnection(
  connectionType?: string,
  connectionString?: string,
  schemas?: string[] | null,
): boolean {
  if (connectionType?.toLowerCase() === "neon" || getNeonManagementPointer(connectionString)) return true;
  if (schemas?.some((schema) => schema.toLowerCase() === "neon_auth")) return true;
  try {
    const host = new URL(connectionString ?? "").hostname.toLowerCase();
    return host.endsWith(".neon.tech") || host.endsWith(".neon.build");
  } catch {
    return false;
  }
}
