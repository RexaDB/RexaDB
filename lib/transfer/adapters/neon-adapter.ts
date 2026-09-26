/**
 * Neon-specific adapter for transfer operations
 * Handles database transfer for Neon Postgres projects
 */

import type {
  ProviderAdapter,
  TransferOptions,
  DatabaseExport,
  StorageExport,
  AuthExport,
  SettingsExport,
  FunctionsExport,
  ImportOutcome,
} from "../transfer-types";
import { runPgDumpSchemaOnly } from "@/lib/db/export-helpers";
import { escapeIdent, escapeLiteral, exportTableDataSql, qualifiedTable } from "../transfer-sql";
import { serverTransferQuery } from "../transfer-server-query";
import { MAX_STORAGE_TOTAL_BYTES } from "../supabase-api";
import {
  downloadNeonObject,
  ensureNeonBucket,
  listNeonBuckets,
  listNeonObjects,
  sanitizeBucketName,
  uploadNeonObject,
} from "../neon-storage";
import { resolveEffectiveConnectionString } from "@/lib/db/neon-cli-client";
import { parseNeonCliConnectionString } from "@/lib/neon-cli/pointer";
import { buildCompatDiffs } from "../function-compat";

/** CLI context (profile/project/branch) parsed from a neon-cli:// pointer. */
function neonContext(connectionString: string): { profile: string; projectId: string; branch: string } | null {
  const pointer = parseNeonCliConnectionString(connectionString);
  if (!pointer) return null;
  return { profile: pointer.profile, projectId: pointer.projectId, branch: pointer.branchId };
}

/** Run a `neon` CLI command with project context; JSON output parsed leniently. */
async function runNeonCli(
  connectionString: string,
  args: string[],
  opts?: { timeoutMs?: number; cwd?: string; jsonOutput?: boolean },
): Promise<{ ok: boolean; json: unknown; error?: string }> {
  const ctx = neonContext(connectionString);
  if (!ctx) return { ok: false, json: null, error: "not a neon-cli:// connection" };
  try {
    const { locateNeonCli } = await import("@/lib/neon-cli/cli-runner");
    const found = locateNeonCli();
    if (!found) return { ok: false, json: null, error: "neon CLI not installed" };
    const { spawn } = await import("child_process");
    const wantJson = opts?.jsonOutput !== false;
    const fullArgs = [
      ...args,
      "--profile", ctx.profile,
      "--project-id", ctx.projectId,
      "--branch", ctx.branch,
      ...(wantJson ? ["-o", "json"] : []),
    ];
    const proc = spawn(found.path, fullArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
      cwd: opts?.cwd,
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
      return { ok: false, json: null, error: stderr.trim().split("\n").pop() || `exited with code ${code}` };
    }
    if (!wantJson) return { ok: true, json: stdout };
    try {
      return { ok: true, json: JSON.parse(stdout) };
    } catch {
      return { ok: false, json: null, error: "could not parse CLI output" };
    }
  } catch (error) {
    return { ok: false, json: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export class NeonAdapter implements ProviderAdapter {
  type = "neon" as const;
  
  async validateConnection(connectionString: string): Promise<boolean> {
    try {
      const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
      const result = await serverTransferQuery(effectiveConnectionString, "SELECT 1");
      return result.success;
    } catch {
      return false;
    }
  }
  
  async exportDatabase(connectionString: string, options: TransferOptions): Promise<DatabaseExport> {
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
    const schemaSql = await runPgDumpSchemaOnly(effectiveConnectionString, serverTransferQuery);

    // Get table list and row counts
    const tablesResult = await serverTransferQuery(
      effectiveConnectionString,
      `SELECT table_name, table_schema 
       FROM information_schema.tables 
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name`
    );

    const tables: string[] = [];
    const rowCounts: Record<string, number> = {};
    const exportedRowCounts: Record<string, number> = {};
    const warnings: string[] = [];
    let dataSql = "";

    if (tablesResult.success && tablesResult.data?.rows) {
      for (const row of tablesResult.data.rows) {
        const tableSchema = String(row.table_schema);
        const tableName = String(row.table_name);
        const tableFullName = `${tableSchema}.${tableName}`;
        tables.push(tableFullName);

        // Get row count for each table
        const countResult = await serverTransferQuery(
          effectiveConnectionString,
          `SELECT COUNT(*) as count FROM ${qualifiedTable(tableSchema, tableName)}`
        );

        if (countResult.success && countResult.data?.rows?.[0]) {
          rowCounts[tableFullName] = Number(countResult.data.rows[0].count) || 0;
        }

        // Export row data for reasonably-sized tables; the rest migrate
        // schema-only and are reported so stats stay honest.
        const exported = await exportTableDataSql(
          serverTransferQuery,
          effectiveConnectionString,
          tableSchema,
          tableName,
          rowCounts[tableFullName] || 0,
        );
        dataSql += exported.sql;
        exportedRowCounts[tableFullName] = exported.exportedRows;
        if (exported.message) warnings.push(exported.message);
      }
    }

    return {
      schemaSql,
      dataSql: dataSql || undefined,
      tables,
      rowCounts,
      exportedRowCounts,
      warnings,
    };
  }

  async importDatabase(connectionString: string, data: DatabaseExport, options: TransferOptions): Promise<ImportOutcome | void> {
    const { resetAndApplySql } = await import("@/lib/db/export-helpers");
    const { sanitizeExtensionsForDestination } = await import("../schema-dump-sql");
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);

    // Probe extensions first (see supabase adapter): rejected ones become
    // warnings instead of rolling back the whole import.
    const sanitized = await sanitizeExtensionsForDestination(serverTransferQuery, effectiveConnectionString, data.schemaSql);

    // Single transaction (drops + schema + FK-ordered row data): failure
    // rolls everything back instead of leaving a partial destination.
    await resetAndApplySql(effectiveConnectionString, sanitized.sql, data.dataSql, serverTransferQuery);
    if (sanitized.warnings.length > 0) return { warnings: sanitized.warnings };
  }
  
  // Neon Object Storage holds bytes outside Postgres, so there is nothing
  // SQL-reachable to export here. There is intentionally NO importStorage:
  // the service reports Supabase-shaped storage as skipped with a
  // user-visible warning instead of silently discarding it.
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    const warnings: string[] = [];
    const listed = await listNeonBuckets(connectionString);
    if ("error" in listed) {
      return { buckets: [], files: [], warnings: [`Failed to list Neon buckets: ${listed.error}`] };
    }
    const buckets = listed.buckets;
    const files: StorageExport["files"] = [];
    let totalBytes = 0;
    for (const bucket of buckets) {
      const objects = await listNeonObjects(connectionString, bucket.name);
      if ("error" in objects) {
        warnings.push(`Failed to list objects for bucket ${bucket.name}: ${objects.error}`);
        continue;
      }
      for (const key of objects.keys) {
        const entry: StorageExport["files"][number] = { bucketId: bucket.name, path: key, metadata: {} };
        if (totalBytes >= MAX_STORAGE_TOTAL_BYTES) {
          warnings.push(`Storage byte budget exceeded: ${key} and remaining files migrate metadata-only.`);
        } else {
          const dl = await downloadNeonObject(connectionString, bucket.name, key);
          if ("bytes" in dl) {
            totalBytes += dl.bytes.length;
            entry.contentBase64 = dl.bytes.toString("base64");
            entry.size = dl.bytes.length;
          } else {
            warnings.push(`Could not download ${bucket.name}/${key}: ${dl.error} (listed, contents skipped).`);
          }
        }
        files.push(entry);
      }
    }
    if (buckets.length === 0) warnings.push("No Neon Object Storage buckets found on this branch.");
    return {
      buckets: buckets.map((b) => ({
        id: b.name,
        name: b.name,
        public: b.accessLevel === "public_read",
        file_size_limit: null,
        allowed_mime_types: null,
      })),
      files,
      warnings,
    };
  }

  async importStorage?(connectionString: string, data: StorageExport, options: TransferOptions) {
    // Supabase buckets land in Neon Object Storage: sanitize names to S3
    // rules, create buckets (public stays public), upload carried bytes.
    const warnings: string[] = [];
    let bucketsOk = 0;
    let filesOk = 0;
    const nameMap = new Map<string, string>();
    for (const bucket of data.buckets) {
      const { name: destName, renamed } = sanitizeBucketName(bucket.name);
      nameMap.set(bucket.id, destName);
      if (renamed) warnings.push(`Bucket ${bucket.name} renamed to ${destName} (S3 naming rules).`);
      const created = await ensureNeonBucket(connectionString, destName, bucket.public);
      if ("ok" in created) bucketsOk++;
      else warnings.push(`Failed to create bucket ${destName}: ${created.error}`);
    }
    const withBytes = data.files.filter((f) => f.contentBase64);
    const metadataOnly = data.files.length - withBytes.length;
    for (const file of withBytes) {
      const destBucket = nameMap.get(file.bucketId) ?? sanitizeBucketName(file.bucketId).name;
      try {
        const bytes = Buffer.from(file.contentBase64 as string, "base64");
        const meta = (file.metadata ?? {}) as Record<string, unknown>;
        const contentType = typeof meta.mimetype === "string" ? meta.mimetype : undefined;
        const up = await uploadNeonObject(connectionString, destBucket, file.path, bytes, contentType);
        if ("ok" in up) filesOk++;
        else warnings.push(`Failed to upload ${destBucket}/${file.path}: ${up.error} (bucket migrated, contents skipped).`);
      } catch (error) {
        warnings.push(`Failed to upload ${destBucket}/${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (metadataOnly > 0) {
      warnings.push(
        `${metadataOnly} file(s) migrated metadata-only: contents were not in the export and were NOT copied.`,
      );
    }
    return { warnings, stats: { storageBucketsTransferred: bucketsOk, storageFilesTransferred: filesOk } };
  }

  // Neon Auth lives in neon_auth tables (migrating with the database
  // transfer), but Supabase-shaped GoTrue exports are mapped into
  // neon_auth.user by importAuth below — passwords excluded (bcrypt vs
  // scrypt), OAuth provider setup stays a console task.
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    return {
      users: [],
      providers: [],
      policies: [],
      warnings: ["Neon Auth migrates with the database transfer (neon_auth tables); the Supabase-shaped auth export is empty."],
    };
  }

  /**
   * Map Supabase GoTrue users into Neon Auth's neon_auth.user table.
   * Columns are discovered at runtime; only known-safe mappings are
   * written. Password hashes CANNOT transfer (bcrypt vs scrypt) — those
   * users must reset passwords. Absent neon_auth schema → clean skip.
   */
  async importAuth?(connectionString: string, data: AuthExport, options: TransferOptions): Promise<ImportOutcome | void> {
    const warnings: string[] = [];
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);

    const colsRes = await serverTransferQuery(
      effectiveConnectionString,
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'neon_auth' AND table_name = 'user'`,
    );
    if (!colsRes.success || (colsRes.data?.rows ?? []).length === 0) {
      if (data.users.length > 0 || data.providers.length > 0) {
        warnings.push(
          `Auth not transferred: ${data.users.length} user(s) exported, but this Neon project has no neon_auth schema (Neon Auth not provisioned) — skipped, not imported.`,
        );
      }
      return { warnings, stats: { authUsersTransferred: 0, authProvidersTransferred: 0 } };
    }
    const cols = new Set((colsRes.data?.rows ?? []).map((r) => String(r.column_name)));

    let usersOk = 0;
    for (const user of data.users) {
      try {
        // Best-effort Better Auth column mapping from discovered columns.
        const pairs: Array<[string, string]> = [];
        const put = (col: string, sqlLiteral: string) => {
          if (cols.has(col)) pairs.push([col, sqlLiteral]);
        };
        put("id", escapeLiteral(user.id));
        put("email", escapeLiteral(user.email));
        const name =
          (user.raw_user_meta_data as Record<string, unknown> | undefined)?.name ??
          (user.raw_user_meta_data as Record<string, unknown> | undefined)?.full_name;
        if (typeof name === "string" && name) put("name", escapeLiteral(name));
        put("emailVerified", user.email_confirmed_at ? "TRUE" : "FALSE");
        put("createdAt", escapeLiteral(user.created_at));
        put("updatedAt", escapeLiteral(user.updated_at));
        if (pairs.length < 2) {
          warnings.push(`User ${user.email}: neon_auth.user has no recognizable columns; skipped.`);
          continue;
        }
        const res = await serverTransferQuery(
          effectiveConnectionString,
          `INSERT INTO "neon_auth"."user" (${pairs.map(([c]) => escapeIdent(c)).join(", ")}) VALUES (${pairs.map(([, v]) => v).join(", ")}) ON CONFLICT DO NOTHING;`,
        );
        if (res.success) {
          usersOk++;
          if (user.encrypted_password != null) {
            warnings.push(`User ${user.email}: password hash cannot transfer (Supabase bcrypt vs Neon scrypt) — password reset required.`);
          }
        } else {
          warnings.push(`User ${user.email}: ${String(res.error ?? "unknown error")}`);
        }
      } catch (error) {
        warnings.push(`User ${user.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (data.providers.length > 0) {
      warnings.push(
        `${data.providers.length} OAuth provider config(s) not transferred: Neon Auth provider setup lives outside SQL — configure providers in the Neon console.`,
      );
    }
    return { warnings, stats: { authUsersTransferred: usersOk, authProvidersTransferred: 0 } };
  }
  
  async exportSettings(connectionString: string, options: TransferOptions): Promise<SettingsExport> {
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
    const projectSettings: Record<string, unknown> = {};
    
    try {
      // Try to get any Neon-specific settings
      const settingsResult = await serverTransferQuery(
        effectiveConnectionString,
        `SELECT * FROM pg_settings WHERE name LIKE '%neon%' LIMIT 10`
      );
      
      if (settingsResult.success && settingsResult.data?.rows) {
        for (const row of settingsResult.data.rows) {
          projectSettings[String(row.name)] = row.setting;
        }
      }
    } catch (error) {
      // Ignore errors
    }
    
    return {
      projectSettings,
    };
  }
  
  async importSettings(connectionString: string, data: SettingsExport, options: TransferOptions): Promise<void> {
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);

    // Import any applicable settings
    if (Object.keys(data.projectSettings).length > 0) {
      try {
        console.log("Neon settings import:", Object.keys(data.projectSettings).length, "settings");
      } catch (error) {
        console.warn("Failed to import Neon settings:", error);
      }
    }
  }

  async exportFunctions(connectionString: string, options: TransferOptions): Promise<FunctionsExport> {
    const warnings: string[] = [];
    const listed = await runNeonCli(connectionString, ["functions", "list"]);
    if (!listed.ok) {
      return { functions: [], warnings: [`Failed to list Neon functions: ${listed.error}`] };
    }
    const items: any[] = Array.isArray(listed.json) ? listed.json : Array.isArray((listed.json as any)?.data) ? (listed.json as any).data : [];
    const functions: FunctionsExport["functions"] = [];
    for (const item of items.slice(0, 50)) {
      const slug = String(item?.slug ?? item?.name ?? item?.id ?? "");
      if (!slug) continue;
      // Details may or may not embed sources; capture files when present.
      const got = await runNeonCli(connectionString, ["functions", "get", slug]);
      let files: Array<{ path: string; content: string }> = [];
      if (got.ok) {
        const detail = got.json as any;
        const source = detail?.source ?? detail?.code ?? detail?.files?.index ?? detail?.data?.source;
        if (typeof source === "string" && source) {
          files = [{ path: "index.ts", content: source.slice(0, 500_000) }];
        } else if (Array.isArray(detail?.files)) {
          files = detail.files
            .filter((f: any) => typeof f?.path === "string" && typeof f?.content === "string")
            .map((f: any) => ({ path: String(f.path), content: String(f.content).slice(0, 500_000) }));
        }
      }
      if (files.length === 0) {
        warnings.push(`Function ${slug}: CLI exposes no sources; metadata recorded without code.`);
      }
      functions.push({
        slug,
        provider: "neon",
        files,
        diffs: buildCompatDiffs(slug, "neon", files),
      });
    }
    if (items.length === 0) warnings.push("No functions found on Neon branch.");
    return { functions, warnings };
  }

  async importFunctions(connectionString: string, data: FunctionsExport, options: TransferOptions) {
    const warnings: string[] = [];
    let deployed = 0;
    const { mkdtemp, writeFile, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    for (const fn of data.functions) {
      // Same-family deploys go verbatim; foreign sources deploy their
      // pre-ported transform after review warning.
      const useFiles =
        fn.provider === "neon"
          ? fn.files
          : (fn.diffs.find((d) => d.targetProvider === "neon")?.transformedFiles ?? fn.files);
      if (fn.provider !== "neon") {
        warnings.push(`Function ${fn.slug}: deploying auto-ported draft — review its compat diff first; runtime APIs may differ.`);
      }
      if (useFiles.length === 0) {
        warnings.push(`Function ${fn.slug}: no sources to deploy; skipped.`);
        continue;
      }
      let dir = "";
      try {
        dir = await mkdtemp(join(tmpdir(), `neon-fn-${fn.slug}-`));
        for (const file of useFiles) {
          const safePath = file.path.replace(/^\//, "").replace(/\.\./g, "_").slice(0, 200) || "index.ts";
          await writeFile(join(dir, safePath), file.content);
        }
        const res = await runNeonCli(connectionString, ["functions", "deploy", fn.slug], {
          cwd: dir,
          timeoutMs: 120000,
          jsonOutput: false,
        });
        if (res.ok) deployed++;
        else warnings.push(`Function ${fn.slug}: deploy failed (${res.error}). Sources preserved in package — deploy manually with \`neon functions deploy ${fn.slug}\`.`);
      } catch (error) {
        warnings.push(`Function ${fn.slug}: deploy failed (${error instanceof Error ? error.message : String(error)}).`);
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
    return { warnings, stats: { functionsTransferred: deployed } };
  }
  
  async getProjectInfo(connectionString: string): Promise<{ name: string; id: string }> {
    try {
      const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
      
      // Extract project ID from Neon connection string
      const match = effectiveConnectionString.match(/neon:\/\/([^:]+)@([^\/.]+)\.([^\/]+)/);
      if (match) {
        return { name: match[2], id: match[2] };
      }
      
      // Fallback to database name
      const result = await serverTransferQuery(effectiveConnectionString, "SELECT current_database()");
      if (result.success && result.data?.rows?.[0]) {
        const dbName = String(result.data.rows[0].current_database);
        return { name: dbName, id: dbName };
      }
    } catch {
      // Ignore error
    }
    
    return { name: "Unknown", id: "unknown" };
  }
}