// Browser-safe. Talks to the sidecar's /api/neon-cli/* routes, which spawn
// the real `neon` CLI on the server side. Mirrors lib/supabase-mgmt/client.ts.
import { API_BASE } from "@/lib/api-base";

function neonCliBase(): string {
  return `${API_BASE}/api/neon-cli`;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${neonCliBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `neon-cli ${path} failed (${res.status})`);
  }
  return (json?.data ?? json) as T;
}

export interface NeonProject {
  id: string;
  name: string;
  region_id?: string;
  created_at?: string;
  org_id?: string;
}

export interface NeonOrg {
  id: string;
  name: string;
}

export interface NeonBranch {
  id: string;
  name: string;
  default?: boolean;
  current_state?: string;
  created_at?: string;
}

export interface NeonDatabase {
  name: string;
  owner_name?: string;
  created_at?: string;
}

export interface NeonRole {
  name: string;
  created_at?: string;
}

export function listOrgs(profile: string): Promise<NeonOrg[]> {
  return post<NeonOrg[]>("/orgs", { profile });
}

export function listProjects(profile: string, orgId?: string): Promise<NeonProject[]> {
  return post<NeonProject[]>("/projects", { profile, orgId });
}

export function listBranches(profile: string, projectId: string): Promise<NeonBranch[]> {
  return post<NeonBranch[]>("/branches", { profile, projectId });
}

export function listDatabases(profile: string, projectId: string, branchId: string): Promise<NeonDatabase[]> {
  return post<NeonDatabase[]>("/databases", { profile, projectId, branchId });
}

export function listRoles(profile: string, projectId: string, branchId: string): Promise<NeonRole[]> {
  return post<NeonRole[]>("/roles", { profile, projectId, branchId });
}

export function removeProfile(profile: string): Promise<void> {
  return post<void>("/remove-profile", { profile });
}

export interface NeonLoginEvent {
  type: "log" | "open-url" | "done" | "error";
  message?: string;
  url?: string;
  success?: boolean;
}

/**
 * Streams `neon auth --profile <name>` progress via SSE. Returns an abort
 * function; onEvent fires for each line the real CLI prints (including a
 * detected "open this URL" line, in case it can't auto-open a browser).
 */
export function streamNeonLogin(
  profileName: string,
  onEvent: (event: NeonLoginEvent) => void,
): { abort: () => void } {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${neonCliBase()}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileName }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const line = frame.split("\n").find((part) => part.startsWith("data:"));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as NeonLoginEvent);
          } catch {
            // ignore malformed frame
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      onEvent({ type: "error", message: err instanceof Error ? err.message : "Login failed" });
    }
  })();

  return { abort: () => controller.abort() };
}
