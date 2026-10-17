// Server-only. Neon account/API integration for RexaDB.
//
// Historically this spawned the real `neonctl` binary. We now run neonctl's
// public OAuth (client_id "neonctl" + PKCE) and call the Neon Management API
// in-process — no neonctl install required. Credential files stay in the same
// ~/.config/neon layout neonctl uses so existing sessions still Continue.
//
// Imported only by server/index.ts and lib/db/neon-cli-client.ts.
import { execSync, type ChildProcess } from "child_process";
import { startNeonAuthFlow } from "@/lib/neon-oauth/auth-flow";
import {
  authStatus,
  getConnectionUri,
  getCurrentUser,
  listBranches,
  listDatabases,
  listOrgs,
  listProjects,
  listRoles,
  profileList,
  profileRemove,
  updateProfileMeta,
  writeCredentials,
  type NeonBranch,
  type NeonDatabase,
  type NeonOrg,
  type NeonProject,
  type NeonRole,
} from "@/lib/neon-oauth/api";

export type { NeonBranch, NeonDatabase, NeonOrg, NeonProject, NeonRole };

/** Always "installed" — OAuth runs in-process; neonctl is optional. */
export function locateNeonCli(): { path: string; name: string } | null {
  return { path: "builtin-oauth", name: "neon-oauth" };
}

const CANDIDATE_BINARIES = ["neon", "neonctl"];

function which(name: string): string | null {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const found = execSync(cmd, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] })
      .split("\n")[0]
      ?.trim();
    return found || null;
  } catch {
    return null;
  }
}

/**
 * Real neonctl lookup for features that must SH spawn it (transfer of Neon
 * Functions, Object Storage CLI flows). Distinct from locateNeonCli(), whose
 * placeholder would produce a broken spawn arguments-less process.
 */
export function locateNeonCliBinary(): { path: string; name: string } | null {
  for (const candidateName of CANDIDATE_BINARIES) {
    const path = which(candidateName);
    if (path) return { path, name: candidateName };
  }
  return null;
}

export function clearNeonCliCache(): void {
  // no-op: nothing to cache for the builtin OAuth path
}

export interface NeonCliDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
}

export async function detectNeonCli(): Promise<NeonCliDetectResult> {
  return { installed: true, version: "oauth", path: "builtin-oauth" };
}

export function neonOrgsList(profile: string): Promise<NeonOrg[]> {
  return listOrgs(profile);
}

export function neonProjectsList(profile: string, orgId?: string): Promise<NeonProject[]> {
  return listProjects(profile, orgId);
}

export function neonBranchesList(profile: string, projectId: string): Promise<NeonBranch[]> {
  return listBranches(profile, projectId);
}

export function neonDatabasesList(
  profile: string,
  projectId: string,
  branchId: string,
): Promise<NeonDatabase[]> {
  return listDatabases(profile, projectId, branchId);
}

export function neonRolesList(
  profile: string,
  projectId: string,
  branchId: string,
): Promise<NeonRole[]> {
  return listRoles(profile, projectId, branchId);
}

export async function neonConnectionString(
  profile: string,
  projectId: string,
  branchId: string,
  database: string,
  role: string,
): Promise<string> {
  const uri = await getConnectionUri(profile, projectId, branchId, database, role, true);
  try {
    const logged = new URL(uri);
    console.log(
      `[neon-oauth] resolved connection string for ${projectId}/${branchId}/${database}: host=${logged.hostname} database=${logged.pathname.replace(/^\//, "")}`,
    );
  } catch {
    // ignore parse errors in logging
  }
  return uri;
}

export interface NeonProfile {
  name: string;
  label?: string;
  userId?: string;
}

export async function neonProfileList(): Promise<NeonProfile[]> {
  return profileList().map((p) => ({
    name: p.name,
    label: p.label,
    userId: p.userId,
  }));
}

export async function neonProfileRemove(profile: string): Promise<{ success: true }> {
  return profileRemove(profile);
}

export async function neonCurrentUser(
  profile: string,
): Promise<{ id?: string; email?: string } | null> {
  try {
    return await getCurrentUser(profile);
  } catch {
    return null;
  }
}

/**
 * Compatibility shim: older server code treated login as a ChildProcess with
 * stdout/stderr. The OAuth flow is event-driven instead — see
 * `runNeonAuthLogin` and the `/api/neon-cli/login` route.
 */
export function spawnNeonAuthLogin(_profileName: string): ChildProcess {
  throw new Error(
    "spawnNeonAuthLogin is no longer used — call runNeonAuthLogin via the login route.",
  );
}

export interface NeonAuthLoginEvents {
  onLog: (message: string) => void;
  onOpenUrl: (url: string) => void;
  /** Called with account email/id after a successful sign-in (best-effort). */
  onComplete?: (info: { email?: string; userId?: string }) => void;
  signal?: AbortSignal;
  /** Force IdP account picker (add-account). */
  forceLogin?: boolean;
}

/**
 * Runs neonctl-compatible public OAuth for `profile`, streaming progress via
 * callbacks. Persists credentials under ~/.config/neon.
 */
export async function runNeonAuthLogin(
  profileName: string,
  events: NeonAuthLoginEvents,
): Promise<void> {
  events.onLog(`Starting Neon sign-in for profile “${profileName}”…`);
  const flow = await startNeonAuthFlow({
    profile: profileName,
    forceLogin: events.forceLogin,
  });

  const onAbort = () => flow.cancel();
  events.signal?.addEventListener("abort", onAbort, { once: true });
  // Discovery/setup was awaited above; the caller's abort may have fired
  // before the listener was attached. Bail out before opening the browser.
  if (events.signal?.aborted) {
    onAbort();
    return;
  }

  try {
    events.onOpenUrl(flow.authUrl);
    events.onLog("Opening browser for sign-in…");
    const creds = await flow.result;

    // Enrich profile metadata from /users/me when possible.
    let email: string | undefined;
    let userId: string | undefined;
    try {
      writeCredentials(profileName, creds);
      const user = await getCurrentUser(profileName);
      email = user.email;
      userId = user.id;
      updateProfileMeta(profileName, {
        label: email ?? null,
        userId: userId ?? null,
      });
      if (email) {
        events.onLog(`Signed in as ${email}`);
      } else {
        events.onLog("Signed in to Neon");
      }
    } catch (e: any) {
      // credentials already written by the auth flow; metadata is best-effort
      events.onLog(e?.message ? `Signed in (${e.message})` : "Signed in to Neon");
    }
    events.onComplete?.({ email, userId });
  } finally {
    events.signal?.removeEventListener("abort", onAbort);
  }
}

export interface NeonAuthStatus {
  profile: string;
  valid: boolean;
  email?: string;
  userId?: string;
  error?: string;
}

export async function neonAuthStatus(profiles: string[]): Promise<NeonAuthStatus[]> {
  return authStatus(profiles);
}
