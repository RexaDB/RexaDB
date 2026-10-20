// Server-only. Neon account/API integration for RexaDB.
//
// Historically this spawned the real `neonctl` binary. We now run neonctl's
// public OAuth (client_id "neonctl" + PKCE) and call the Neon Management API
// in-process — no neonctl install required. Credential files stay in the same
// ~/.config/neon layout neonctl uses so existing sessions still Continue.
//
// Effect APIs (`*Effect`) are preferred for the sidecar. Promise facades keep
// dual-use callers (neon-cli-client, tests) working.
//
// Imported only by server/index.ts and lib/db/neon-cli-client.ts.
import { execSync, type ChildProcess } from "child_process";
import { Effect } from "effect";
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
  listFunctions,
  listBuckets,
  createBucket,
  profileList,
  profileRemove,
  updateProfileMeta,
  writeCredentials,
  type NeonBranch,
  type NeonBucket,
  type NeonDatabase,
  type NeonFunction,
  type NeonOrg,
  type NeonProject,
  type NeonRole,
} from "@/lib/neon-oauth/api";
import { toNeonCliError, type NeonCliError } from "./effect-errors";

export type { NeonBranch, NeonBucket, NeonDatabase, NeonFunction, NeonOrg, NeonProject, NeonRole };
export type { NeonCliError } from "./effect-errors";

function fromNeonPromise<A>(
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, NeonCliError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) => toNeonCliError(cause),
  });
}

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

export const detectNeonCliEffect = (): Effect.Effect<
  NeonCliDetectResult,
  never
> =>
  Effect.succeed({
    installed: true,
    version: "oauth",
    path: "builtin-oauth",
  });

export async function detectNeonCli(): Promise<NeonCliDetectResult> {
  return Effect.runPromise(detectNeonCliEffect());
}

export const neonOrgsListEffect = (
  profile: string,
): Effect.Effect<NeonOrg[], NeonCliError> =>
  fromNeonPromise(() => listOrgs(profile));

export function neonOrgsList(profile: string): Promise<NeonOrg[]> {
  return Effect.runPromise(neonOrgsListEffect(profile));
}

export const neonProjectsListEffect = (
  profile: string,
  orgId?: string,
): Effect.Effect<NeonProject[], NeonCliError> =>
  fromNeonPromise(() => listProjects(profile, orgId));

export function neonProjectsList(
  profile: string,
  orgId?: string,
): Promise<NeonProject[]> {
  return Effect.runPromise(neonProjectsListEffect(profile, orgId));
}

export const neonBranchesListEffect = (
  profile: string,
  projectId: string,
): Effect.Effect<NeonBranch[], NeonCliError> =>
  fromNeonPromise(() => listBranches(profile, projectId));

export function neonBranchesList(
  profile: string,
  projectId: string,
): Promise<NeonBranch[]> {
  return Effect.runPromise(neonBranchesListEffect(profile, projectId));
}

export const neonDatabasesListEffect = (
  profile: string,
  projectId: string,
  branchId: string,
): Effect.Effect<NeonDatabase[], NeonCliError> =>
  fromNeonPromise(() => listDatabases(profile, projectId, branchId));

export function neonDatabasesList(
  profile: string,
  projectId: string,
  branchId: string,
): Promise<NeonDatabase[]> {
  return Effect.runPromise(
    neonDatabasesListEffect(profile, projectId, branchId),
  );
}

export const neonRolesListEffect = (
  profile: string,
  projectId: string,
  branchId: string,
): Effect.Effect<NeonRole[], NeonCliError> =>
  fromNeonPromise(() => listRoles(profile, projectId, branchId));

export function neonRolesList(
  profile: string,
  projectId: string,
  branchId: string,
): Promise<NeonRole[]> {
  return Effect.runPromise(neonRolesListEffect(profile, projectId, branchId));
}

export const neonConnectionStringEffect = (
  profile: string,
  projectId: string,
  branchId: string,
  database: string,
  role: string,
): Effect.Effect<string, NeonCliError> =>
  fromNeonPromise(async () => {
    const uri = await getConnectionUri(
      profile,
      projectId,
      branchId,
      database,
      role,
      true,
    );
    try {
      const logged = new URL(uri);
      console.log(
        `[neon-oauth] resolved connection string for ${projectId}/${branchId}/${database}: host=${logged.hostname} database=${logged.pathname.replace(/^\//, "")}`,
      );
    } catch {
      // ignore parse errors in logging
    }
    return uri;
  });

export async function neonConnectionString(
  profile: string,
  projectId: string,
  branchId: string,
  database: string,
  role: string,
): Promise<string> {
  return Effect.runPromise(
    neonConnectionStringEffect(profile, projectId, branchId, database, role),
  );
}

export const neonFunctionsListEffect = (
  profile: string,
  projectId: string,
  branchId: string,
): Effect.Effect<NeonFunction[], NeonCliError> =>
  fromNeonPromise(() => listFunctions(profile, projectId, branchId));

export const neonBucketsListEffect = (
  profile: string,
  projectId: string,
  branchId: string,
): Effect.Effect<NeonBucket[], NeonCliError> =>
  fromNeonPromise(() => listBuckets(profile, projectId, branchId));

export const neonBucketCreateEffect = (
  profile: string,
  projectId: string,
  branchId: string,
  name: string,
  accessLevel: "private" | "public_read",
): Effect.Effect<void, NeonCliError> =>
  fromNeonPromise(() => createBucket(profile, projectId, branchId, name, accessLevel));

export interface NeonProfile {
  name: string;
  label?: string;
  userId?: string;
}

export const neonProfileListEffect = (): Effect.Effect<
  NeonProfile[],
  never
> =>
  Effect.sync(() =>
    profileList().map((p) => ({
      name: p.name,
      label: p.label,
      userId: p.userId,
    })),
  );

export async function neonProfileList(): Promise<NeonProfile[]> {
  return Effect.runPromise(neonProfileListEffect());
}

export const neonProfileRemoveEffect = (
  profile: string,
): Effect.Effect<{ success: true }, NeonCliError> =>
  // profileRemove is synchronous — use Effect.try, not fromNeonPromise.
  Effect.try({
    try: () => profileRemove(profile),
    catch: (cause) => toNeonCliError(cause),
  });

export async function neonProfileRemove(
  profile: string,
): Promise<{ success: true }> {
  return Effect.runPromise(neonProfileRemoveEffect(profile));
}

export const neonCurrentUserEffect = (
  profile: string,
): Effect.Effect<{ id?: string; email?: string } | null, never> =>
  fromNeonPromise(() => getCurrentUser(profile)).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );

export async function neonCurrentUser(
  profile: string,
): Promise<{ id?: string; email?: string } | null> {
  return Effect.runPromise(neonCurrentUserEffect(profile));
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
 * callbacks. Persists credentials under ~/.config/neon (Effect).
 */
export const runNeonAuthLoginEffect = (
  profileName: string,
  events: NeonAuthLoginEvents,
): Effect.Effect<void, NeonCliError> =>
  Effect.tryPromise({
    try: async () => {
      events.onLog(`Starting Neon sign-in for profile “${profileName}”…`);
      const flow = await startNeonAuthFlow({
        profile: profileName,
        forceLogin: events.forceLogin,
      });

      const onAbort = () => flow.cancel();
      events.signal?.addEventListener("abort", onAbort, { once: true });
      // Discovery/setup was awaited above; the caller's abort may have fired
      // before the listener was attached. Bail out before opening the browser —
      // critical: flow.cancel() rejects flow.result, and that rejection MUST be
      // consumed or Bun treats the unhandled rejection as fatal (kills the
      // sidecar mid-run, taking every in-flight DB operation with it).
      if (events.signal?.aborted) {
        void flow.result.catch(() => undefined);
        try {
          events.signal.removeEventListener("abort", onAbort);
        } catch {
          // ignore
        }
        throw new Error("Sign-in cancelled");
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
          events.onLog(
            e?.message ? `Signed in (${e.message})` : "Signed in to Neon",
          );
        }
        events.onComplete?.({ email, userId });
      } finally {
        events.signal?.removeEventListener("abort", onAbort);
      }
    },
    catch: (cause) => toNeonCliError(cause),
  });

/**
 * Promise facade for runNeonAuthLoginEffect (tests + SSE route).
 */
export async function runNeonAuthLogin(
  profileName: string,
  events: NeonAuthLoginEvents,
): Promise<void> {
  return Effect.runPromise(runNeonAuthLoginEffect(profileName, events));
}

export interface NeonAuthStatus {
  profile: string;
  valid: boolean;
  email?: string;
  userId?: string;
  error?: string;
}

export const neonAuthStatusEffect = (
  profiles: string[],
): Effect.Effect<NeonAuthStatus[], NeonCliError> =>
  fromNeonPromise(() => authStatus(profiles));

export async function neonAuthStatus(
  profiles: string[],
): Promise<NeonAuthStatus[]> {
  return Effect.runPromise(neonAuthStatusEffect(profiles));
}
