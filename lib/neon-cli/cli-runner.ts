// Server-only. Spawns the real `neon` CLI (npm package `neonctl`) as a
// subprocess — genuine Neon software handling its own OAuth login, never a
// reimplementation of Neon's auth flow under its identity. Imported only by
// server/index.ts (the sidecar) and lib/db/neon-cli-client.ts, both of which
// run in the sidecar's Node/Bun process — never bundled into the browser.
import { spawn, execSync, type ChildProcess } from "child_process";
import { NEON_SESSION_EXPIRED_MESSAGE } from "./errors";

const CANDIDATE_BINARIES = ["neon", "neonctl"];

let cachedBinary: { path: string; name: string } | null | undefined;

function which(name: string): string | null {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .trim()
      .split("\n")[0]
      ?.trim();
    return result && result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** Locates the real `neon` (or legacy `neonctl`) binary on PATH. Cached for the process lifetime. */
export function locateNeonCli(): { path: string; name: string } | null {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const name of CANDIDATE_BINARIES) {
    const path = which(name);
    if (path) {
      cachedBinary = { path, name };
      return cachedBinary;
    }
  }
  cachedBinary = null;
  return null;
}

/** Clears the cached "is it installed" result — call after prompting the user to install it. */
export function clearNeonCliCache(): void {
  cachedBinary = undefined;
}

export interface NeonCliDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
}

export async function detectNeonCli(): Promise<NeonCliDetectResult> {
  // Always re-probe PATH here — this is what "check again" after installing
  // the CLI calls, so a cached "not found" from before the install would
  // otherwise stick for the sidecar process's entire lifetime.
  clearNeonCliCache();
  const found = locateNeonCli();
  if (!found) return { installed: false };
  try {
    const version = execSync(`"${found.path}" --version`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { installed: true, version, path: found.path };
  } catch {
    return { installed: true, path: found.path };
  }
}

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const found = locateNeonCli();
  if (!found) {
    return Promise.reject(new Error("neon CLI is not installed or not on PATH."));
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(found.path, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // CI mode makes the CLI throw instead of silently opening a browser
      // when a profile's session needs re-auth. Every routine call (list
      // projects, fetch a connection string...) goes through this function,
      // and stdin is closed immediately below — without this, an expired
      // session made the CLI pop an unprompted login browser mid-background-
      // call. Only the deliberate, user-initiated `neon auth` login
      // (spawnNeonAuthLogin, below) should ever do that.
      env: { ...process.env, CI: "true" },
    });
    proc.stdin?.end();
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

/** Rewrites the CI-mode refusal (see `run()`) into something the user can act on. */
function friendlyNeonError(stderr: string, fallback: string): Error {
  const trimmed = stderr.trim();
  if (/cannot run interactive auth in ci/i.test(trimmed)) {
    return new Error(NEON_SESSION_EXPIRED_MESSAGE);
  }
  return new Error(trimmed || fallback);
}

async function runJson<T>(args: string[]): Promise<T> {
  const { stdout, stderr, code } = await run([...args, "--output", "json"]);
  if (code !== 0) {
    throw friendlyNeonError(stderr, `neon ${args.join(" ")} exited with code ${code}`);
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`Could not parse neon CLI output for: ${args.join(" ")}`);
  }
}

export interface NeonProject {
  id: string;
  name: string;
  region_id?: string;
  created_at?: string;
  org_id?: string;
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

export interface NeonOrg {
  id: string;
  name: string;
}

/**
 * `neon projects list` requires --org-id for any account that belongs to at
 * least one org — omitting it makes the CLI fall back to an interactive
 * `prompts()` picker, which hangs/breaks JSON output since we close stdin
 * immediately. Always resolve and pass --org-id explicitly instead.
 */
export function neonOrgsList(profile: string): Promise<NeonOrg[]> {
  return runJson<NeonOrg[]>(["orgs", "list", "--profile", profile]);
}

export function neonProjectsList(profile: string, orgId?: string): Promise<NeonProject[]> {
  const args = ["projects", "list", "--profile", profile];
  if (orgId) args.push("--org-id", orgId);
  return runJson<NeonProject[]>(args);
}

export function neonBranchesList(profile: string, projectId: string): Promise<NeonBranch[]> {
  return runJson<NeonBranch[]>(["branches", "list", "--project-id", projectId, "--profile", profile]);
}

export function neonDatabasesList(profile: string, projectId: string, branchId: string): Promise<NeonDatabase[]> {
  return runJson<NeonDatabase[]>([
    "databases", "list",
    "--project-id", projectId,
    "--branch", branchId,
    "--profile", profile,
  ]);
}

export function neonRolesList(profile: string, projectId: string, branchId: string): Promise<NeonRole[]> {
  return runJson<NeonRole[]>([
    "roles", "list",
    "--project-id", projectId,
    "--branch", branchId,
    "--profile", profile,
  ]);
}

export interface NeonConnectionStringResult {
  connection_string?: string;
  connectionString?: string;
  uri?: string;
}

export async function neonConnectionString(
  profile: string,
  projectId: string,
  branchId: string,
  database: string,
  role: string,
): Promise<string> {
  const { stdout, stderr, code } = await run([
    "connection-string", branchId,
    "--project-id", projectId,
    "--database-name", database,
    "--role-name", role,
    "--pooled",
  ]);
  if (code !== 0) {
    throw friendlyNeonError(stderr, `Failed to get connection string for ${projectId}/${branchId}/${database}`);
  }
  const uri = stdout.trim().split("\n").pop()?.trim() || "";
  if (!uri.startsWith("postgres")) {
    throw new Error("neon CLI did not return a valid connection string.");
  }
  return uri;
}

export interface NeonProfile {
  name: string;
  label?: string;
  userId?: string;
}

export async function neonProfileList(): Promise<NeonProfile[]> {
  try {
    return await runJson<NeonProfile[]>(["profile", "list"]);
  } catch {
    return [];
  }
}

export async function neonProfileRemove(profile: string): Promise<{ success: true }> {
  const { stderr, code } = await run(["profile", "remove", profile, "--yes"]);
  if (code !== 0) {
    throw new Error(stderr.trim() || `Failed to remove profile ${profile}`);
  }
  return { success: true };
}

export async function neonCurrentUser(profile: string): Promise<{ id?: string; email?: string } | null> {
  try {
    const profiles = await neonProfileList();
    const found = profiles.find((p) => p.name === profile);
    return found ? { id: found.userId, email: found.label } : null;
  } catch {
    return null;
  }
}

/** Spawns `neon auth --profile <name>` — the real, interactive browser login. Caller streams stdout/stderr. */
export function spawnNeonAuthLogin(profileName: string): ChildProcess {
  const found = locateNeonCli();
  if (!found) {
    throw new Error("neon CLI is not installed or not on PATH.");
  }
  const proc = spawn(found.path, ["auth", "--profile", profileName], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CI: "" },
  });
  proc.stdin?.end();
  proc.on("error", () => {});
  return proc;
}
