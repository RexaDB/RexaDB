// Browser-safe. Pure string helpers for the `neon-cli://` pointer scheme —
// no child_process import here, so this is safe for "use client" components.
// The pointer never embeds a secret: it names a profile the real `neon` CLI
// already holds credentials for, plus which project/branch/database/role to
// resolve a live connection string against at connect time.
const NEON_CLI_SCHEME = "neon-cli:";

export interface NeonCliPointer {
  profile: string;
  projectId: string;
  branchId: string;
  database: string;
  role: string;
}

export function isNeonCliConnectionString(connectionString: string): boolean {
  return String(connectionString || "").trim().toLowerCase().startsWith("neon-cli://");
}

export function buildNeonCliConnectionString(pointer: NeonCliPointer): string {
  const path = [pointer.profile, pointer.projectId, pointer.branchId, pointer.database]
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `neon-cli://${path}?role=${encodeURIComponent(pointer.role)}`;
}

export function parseNeonCliConnectionString(connectionString: string): NeonCliPointer | null {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== NEON_CLI_SCHEME) return null;
    const segments = `${url.hostname}${url.pathname}`
      .split("/")
      .filter(Boolean)
      .map((seg) => decodeURIComponent(seg));
    const [profile, projectId, branchId, database] = segments;
    const role = url.searchParams.get("role") || "";
    if (!profile || !projectId || !branchId || !database || !role) return null;
    return { profile, projectId, branchId, database, role };
  } catch {
    return null;
  }
}
