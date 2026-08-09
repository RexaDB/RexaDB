import type { Project } from "supabase-client-sdk";
import { buildSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";

export const ACTIVE_PROJECT_STATUSES = [
  "ACTIVE",
  "ACTIVE_HEALTHY",
  "COMING_UP",
] as const;

export interface RegisterActiveProjectsDeps {
  listProjects: (token: string) => Promise<Project[]>;
  createConnection: (payload: {
    name: string;
    connectionString: string;
    connectionType: string;
  }) => Promise<{ success: boolean }>;
}

export interface ActiveProjectImportResult {
  imported: number;
  alreadyRegistered: number;
  skippedLimit: number;
  failed: number;
}

export function parseProjectRef(connectionString: string): string | null {
  const trimmed = connectionString.trim();
  const match = trimmed.match(/^supabase-mgmt:\/\/([^\/?]+)/i);
  if (!match?.[1]) return null;
  return match[1];
}

export async function registerActiveSupabaseProjects(
  token: string,
  existingConnectionStrings: string[],
  maxConnections: number | null,
  deps: RegisterActiveProjectsDeps,
): Promise<ActiveProjectImportResult> {
  const result: ActiveProjectImportResult = {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    failed: 0,
  };

  let projects: Project[];
  try {
    projects = await deps.listProjects(token);
  } catch {
    return { ...result, failed: 1 };
  }
  if (!Array.isArray(projects)) return result;

  const activeProjects = projects.filter((p) =>
    ACTIVE_PROJECT_STATUSES.includes(
      p.status as (typeof ACTIVE_PROJECT_STATUSES)[number],
    ),
  );

  const existingRefs = new Set<string>();
  for (const conn of existingConnectionStrings) {
    const ref = parseProjectRef(conn);
    if (ref) existingRefs.add(ref);
  }

  for (const project of activeProjects) {
    if (existingRefs.has(project.ref)) {
      result.alreadyRegistered += 1;
      continue;
    }
    if (maxConnections !== null && result.imported >= maxConnections) {
      result.skippedLimit += 1;
      continue;
    }
    try {
      const res = await deps.createConnection({
        name: project.name,
        connectionString: buildSupabaseMgmtConnectionString(
          project.ref,
          token,
        ),
        connectionType: "supabase-mgmt",
      });
      if (res.success) {
        result.imported += 1;
      } else {
        result.failed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
