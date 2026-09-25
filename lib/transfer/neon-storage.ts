/**
 * Server-only Neon Object Storage driver for transfers.
 *
 * Drives the `neon buckets ...` CLI (list/create buckets, list/get/put
 * objects) with explicit project/branch context parsed from neon-cli://
 * pointers. Imported ONLY by the Neon transfer adapter — never
 * client-reachable.
 */

import { MAX_STORAGE_FILE_BYTES } from "./supabase-api";

export interface NeonBucketInfo {
  name: string;
  accessLevel?: string;
}

async function runBuckets(
  connectionString: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const { parseNeonCliConnectionString } = await import("@/lib/neon-cli/pointer");
  const pointer = parseNeonCliConnectionString(connectionString);
  if (!pointer) return { ok: false, stdout: "", error: "not a neon-cli:// connection" };
  try {
    const { locateNeonCli } = await import("@/lib/neon-cli/cli-runner");
    const found = locateNeonCli();
    if (!found) return { ok: false, stdout: "", error: "neon CLI not installed" };
    const { spawn } = await import("child_process");
    const fullArgs = [
      ...args,
      "--profile", pointer.profile,
      "--project-id", pointer.projectId,
      "--branch", pointer.branchId,
      "-o", "json",
    ];
    const proc = spawn(found.path, fullArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    });
    proc.stdin?.end();
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }, opts?.timeoutMs ?? 60000);
    const code: number = await new Promise((resolve) => {
      proc.stdout?.on("data", (c) => {
        stdout += String(c);
      });
      proc.stderr?.on("data", (c) => {
        stderr += String(c);
      });
      proc.on("error", () => resolve(-1));
      proc.on("close", (c) => resolve(c ?? -1));
    });
    clearTimeout(timeout);
    if (code !== 0) {
      return { ok: false, stdout: "", error: stderr.trim().split("\n").pop() || `exited with code ${code}` };
    }
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: "", error: error instanceof Error ? error.message : String(error) };
  }
}

function asJsonArray(stdout: string): any[] {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray((parsed as any)?.data)) return (parsed as any).data;
    if (Array.isArray((parsed as any)?.buckets)) return (parsed as any).buckets;
    if (Array.isArray((parsed as any)?.objects)) return (parsed as any).objects;
    if (Array.isArray((parsed as any)?.Contents)) return (parsed as any).Contents;
  } catch {
    // fall through
  }
  return [];
}

export async function listNeonBuckets(
  connectionString: string,
): Promise<{ buckets: NeonBucketInfo[] } | { error: string }> {
  const res = await runBuckets(connectionString, ["buckets", "list"]);
  if (!res.ok) return { error: res.error ?? "list failed" };
  const buckets = asJsonArray(res.stdout)
    .map((b) => ({
      name: String(b?.name ?? b?.bucket ?? b?.Bucket ?? ""),
      accessLevel: typeof b?.access_level === "string" ? b.access_level : undefined,
    }))
    .filter((b) => b.name);
  return { buckets };
}

export async function ensureNeonBucket(
  connectionString: string,
  name: string,
  publicRead: boolean,
): Promise<{ ok: true } | { error: string }> {
  const args = ["buckets", "create", name];
  if (publicRead) args.push("--access-level", "public_read");
  const res = await runBuckets(connectionString, args);
  if (res.ok) return { ok: true };
  // Idempotent: creating an existing bucket is fine.
  if (/exist|already|conflict|duplicate/i.test(res.error ?? "")) return { ok: true };
  return { error: res.error ?? "create failed" };
}

export async function listNeonObjects(
  connectionString: string,
  bucket: string,
): Promise<{ keys: string[] } | { error: string }> {
  const res = await runBuckets(connectionString, ["buckets", "object", "list", bucket, "--recursive"]);
  if (!res.ok) return { error: res.error ?? "list failed" };
  const keys = asJsonArray(res.stdout)
    .map((o) => (typeof o === "string" ? o : String(o?.key ?? o?.Key ?? o?.name ?? o?.path ?? "")))
    .map((k) => k.replace(/^\//, ""))
    .filter(Boolean);
  return { keys };
}

export async function downloadNeonObject(
  connectionString: string,
  bucket: string,
  key: string,
): Promise<{ bytes: Buffer } | { error: string }> {
  const { mkdtemp, readFile, rm } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "neon-dl-"));
    const dest = join(dir, "object");
    const { spawn } = await import("child_process");
    const { parseNeonCliConnectionString } = await import("@/lib/neon-cli/pointer");
    const { locateNeonCli } = await import("@/lib/neon-cli/cli-runner");
    const pointer = parseNeonCliConnectionString(connectionString);
    const found = locateNeonCli();
    if (!pointer || !found) return { error: "neon CLI context unavailable" };
    let stderr = "";
    const code: number = await new Promise((resolve) => {
      const proc = spawn(
        found.path,
        ["buckets", "object", "get", `${bucket}/${key}`, "--file", dest,
          "--profile", pointer.profile, "--project-id", pointer.projectId, "--branch", pointer.branchId],
        { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CI: "true" } },
      );
      proc.stdin?.end();
      proc.stderr?.on("data", (c) => {
        stderr += String(c);
      });
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {}
      }, 120000);
      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(-1);
      });
      proc.on("close", (c) => {
        clearTimeout(timeout);
        resolve(c ?? -1);
      });
    });
    if (code !== 0) {
      const detail = stderr.trim().split("\n").pop();
      return { error: detail ? `download failed: ${detail.slice(0, 200)}` : `download exited with code ${code}` };
    }
    const bytes = await readFile(dest);
    if (bytes.length > MAX_STORAGE_FILE_BYTES) {
      return { error: `exceeds per-file cap (${bytes.length} bytes)` };
    }
    return { bytes };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function uploadNeonObject(
  connectionString: string,
  bucket: string,
  key: string,
  bytes: Buffer,
  contentType?: string,
): Promise<{ ok: true } | { error: string }> {
  if (bytes.length > MAX_STORAGE_FILE_BYTES) {
    return { error: `exceeds per-file cap (${bytes.length} bytes)` };
  }
  const { mkdtemp, writeFile, rm } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "neon-ul-"));
    const src = join(dir, "object");
    await writeFile(src, bytes);
    const { parseNeonCliConnectionString } = await import("@/lib/neon-cli/pointer");
    const { locateNeonCli } = await import("@/lib/neon-cli/cli-runner");
    const pointer = parseNeonCliConnectionString(connectionString);
    const found = locateNeonCli();
    if (!pointer || !found) return { error: "neon CLI context unavailable" };
    const args = [
      "buckets", "object", "put", `${bucket}/${key}`,
      "--file", src,
      ...(contentType ? ["--content-type", contentType] : []),
      "--profile", pointer.profile, "--project-id", pointer.projectId, "--branch", pointer.branchId,
    ];
    const { spawn } = await import("child_process");
    const outcome: { code: number; stderr: string } = await new Promise((resolve) => {
      const proc = spawn(found.path, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CI: "true" },
      });
      proc.stdin?.end();
      let stderr = "";
      proc.stderr?.on("data", (c) => {
        stderr += String(c);
      });
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {}
      }, 120000);
      proc.on("error", () => {
        clearTimeout(timeout);
        resolve({ code: -1, stderr });
      });
      proc.on("close", (c) => {
        clearTimeout(timeout);
        resolve({ code: c ?? -1, stderr });
      });
    });
    if (outcome.code !== 0) {
      const detail = outcome.stderr.trim().split("\n").pop();
      return { error: detail ? `upload failed: ${detail.slice(0, 200)}` : `upload exited with code ${outcome.code}` };
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Supabase bucket ids are usually UUIDs (S3-safe), but names may contain
 * uppercase/underscores. Sanitize to S3 bucket rules, reporting renames.
 */
export function sanitizeBucketName(name: string): { name: string; renamed: boolean } {
  let out = name.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  if (out.length < 3) out = `bucket-${out || "data"}`;
  out = out.slice(0, 63);
  return { name: out, renamed: out !== name };
}
