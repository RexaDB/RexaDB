/**
 * Supabase-specific adapter for transfer operations
 * Handles database, storage, auth, and settings for Supabase projects
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
import {
  escapeLiteral,
  exportTableDataSql,
  qualifiedTable,
} from "../transfer-sql";
import { serverTransferQuery } from "../transfer-server-query";
import { fetchStorageBuckets, fetchStorageObjects } from "@/lib/studio/storage-utils";
import { fetchAuthProviderConfigs } from "@/lib/studio/auth/fetch";
import {
  MAX_STORAGE_TOTAL_BYTES,
  deploySupabaseFunction,
  downloadStorageObject,
  getSupabaseFunctionBody,
  listSupabaseFunctions,
  resolveSupabaseApiCreds,
  uploadStorageObject,
} from "../supabase-api";
import { buildCompatDiffs } from "../function-compat";
import { isLikelySupabaseConnection } from "@/lib/db/supabase-helpers";

export class SupabaseAdapter implements ProviderAdapter {
  type = "supabase" as const;
  
  async validateConnection(connectionString: string): Promise<boolean> {
    try {
      const result = await serverTransferQuery(connectionString, "SELECT 1");
      return result.success;
    } catch {
      return false;
    }
  }
  
  async exportDatabase(connectionString: string, options: TransferOptions): Promise<DatabaseExport> {
    const schemaSql = await runPgDumpSchemaOnly(connectionString, serverTransferQuery);

    // Get table list and row counts
    const tablesResult = await serverTransferQuery(
      connectionString,
      `SELECT table_name, table_schema 
       FROM information_schema.tables 
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions')
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
          connectionString,
          `SELECT COUNT(*) as count FROM ${qualifiedTable(tableSchema, tableName)}`
        );

        if (countResult.success && countResult.data?.rows?.[0]) {
          rowCounts[tableFullName] = Number(countResult.data.rows[0].count) || 0;
        }

        // Export row data for reasonably-sized tables. Tables above the cap
        // or failed reads migrate schema-only and are reported in warnings
        // so stats never claim rows that were not exported.
        const exported = await exportTableDataSql(
          serverTransferQuery,
          connectionString,
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

    // Probe extensions first: destinations reject some outright (Neon:
    // pg_cron only in `postgres`, supabase_vault unlisted) and one bad
    // CREATE EXTENSION would roll back the whole import. Rejected ones
    // become warnings; everything else still imports atomically.
    const sanitized = await sanitizeExtensionsForDestination(serverTransferQuery, connectionString, data.schemaSql);

    // Single transaction (drops + schema + row data, FK-ordered): a failure
    // rolls everything back, so the destination is never left partially
    // populated. Errors propagate so the transfer reports failure honestly.
    const applied = await resetAndApplySql(connectionString, sanitized.sql, data.dataSql, serverTransferQuery);
    const allWarnings = [...sanitized.warnings, ...(applied?.warnings ?? [])];
    if (allWarnings.length > 0) return { warnings: allWarnings };
  }
  
  async exportStorage(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    const { buckets, error: bucketsError } = await fetchStorageBuckets(connectionString);

    if (bucketsError) {
      console.warn("Failed to fetch storage buckets:", bucketsError);
      return { buckets: [], files: [] };
    }

    const files: StorageExport["files"] = [];
    const warnings: string[] = [];

    // File bytes migrate only with management credentials (service_role via
    // the mgmt API). Without them this stays metadata-only — disclosed, not silent.
    const { creds, warning: credsWarning } = await resolveSupabaseApiCreds(connectionString);
    if (credsWarning) warnings.push(credsWarning);

    let totalBytes = 0;
    for (const bucket of buckets) {
      const { objects, error: objectsError } = await fetchStorageObjects(connectionString, bucket.name);

      if (objectsError) {
        warnings.push(`Failed to list objects for bucket ${bucket.name}: ${objectsError}`);
        continue;
      }

      for (const object of objects) {
        const entry: StorageExport["files"][number] = {
          bucketId: bucket.id,
          path: object.name,
          metadata: object.metadata || {},
          size: object.metadata ? (object.metadata as any).size : undefined,
        };
        // Best-effort byte fetch within budget; metadata always migrates.
        if (creds) {
          if (totalBytes >= MAX_STORAGE_TOTAL_BYTES) {
            warnings.push(`Storage byte budget exceeded: ${object.name} and remaining files migrate metadata-only.`);
          } else {
            const dl = await downloadStorageObject(creds, bucket.name, object.name);
            if ("bytes" in dl) {
              totalBytes += dl.bytes.length;
              entry.contentBase64 = dl.bytes.toString("base64");
              entry.size = dl.bytes.length;
            } else if (dl.error !== "not found") {
              warnings.push(`Could not download ${bucket.name}/${object.name}: ${dl.error} (metadata migrates).`);
            }
          }
        }
        files.push(entry);
      }
    }

    if (files.some((f) => f.contentBase64)) {
      warnings.push(
        `Downloaded ${(totalBytes / 1024 / 1024).toFixed(1)} MB of file contents from ${creds?.projectRef ?? "source"}; files without contents migrate metadata-only.`,
      );
    } else if (files.length > 0) {
      warnings.push(
        `Storage export is metadata-only: ${files.length} file(s) recorded without contents (object bytes are not reachable over SQL${creds ? "" : " and no management token is available"}). File contents will NOT migrate.`,
      );
    }
    return {
      buckets: buckets.map(b => ({
        id: b.id,
        name: b.name,
        public: b.public,
        file_size_limit: b.file_size_limit,
        allowed_mime_types: b.allowed_mime_types,
      })),
      files,
      warnings,
    };
  }
  
  async importStorage(connectionString: string, data: StorageExport, options: TransferOptions) {
    // Create buckets. Values are literal-escaped (see transfer-sql) so source
    // data cannot alter the SQL executed with destination privileges.
    const warnings: string[] = [];
    let bucketsOk = 0;
    let filesOk = 0;
    for (const bucket of data.buckets) {
      try {
        const fileSizeLimit = bucket.file_size_limit === null ? 'NULL' : bucket.file_size_limit;
        const allowedMimeTypes = escapeLiteral(JSON.stringify(bucket.allowed_mime_types || []));

        const createBucketQuery = `
          INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
          VALUES (${escapeLiteral(bucket.id)}, ${escapeLiteral(bucket.name)}, ${bucket.public},
                  ${fileSizeLimit}, ${allowedMimeTypes})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            public = EXCLUDED.public,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
        `;

        const result = await serverTransferQuery(connectionString, createBucketQuery);
        if (!result.success) {
          warnings.push(`Failed to create bucket ${bucket.name}: ${String(result.error ?? "unknown error")}`);
        } else {
          bucketsOk++;
        }
      } catch (error) {
        warnings.push(`Failed to create bucket ${bucket.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // File contents upload when the export carried bytes AND this
    // destination offers management credentials. Otherwise metadata-only,
    // reported per file count — never silently counted as transferred.
    const withBytes = data.files.filter((f) => f.contentBase64);
    const metadataOnly = data.files.length - withBytes.length;
    if (withBytes.length > 0) {
      const { creds, warning: credsWarning } = await resolveSupabaseApiCreds(connectionString);
      if (!creds) {
        warnings.push(
          `${withBytes.length} file(s) carried contents but the destination has no management token${credsWarning ? ` (${credsWarning})` : ""} — contents NOT uploaded.`,
        );
      } else {
        const mimeOf = (f: StorageExport["files"][number]): string | undefined => {
          const m = (f.metadata as Record<string, unknown> | null)?.mimetype;
          return typeof m === "string" ? m : undefined;
        };
        for (const file of withBytes) {
          try {
            const bytes = Buffer.from(file.contentBase64 as string, "base64");
            const up = await uploadStorageObject(creds, file.bucketId, file.path, bytes, mimeOf(file));
            if ("ok" in up) filesOk++;
            else warnings.push(`Failed to upload ${file.bucketId}/${file.path}: ${up.error} (bucket + metadata migrated).`);
          } catch (error) {
            warnings.push(`Failed to upload ${file.bucketId}/${file.path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    if (metadataOnly > 0) {
      warnings.push(
        `${metadataOnly} file(s) migrated metadata-only: contents were not in the export (unreachable over SQL or over budget) and were NOT copied.`,
      );
    }
    return { warnings, stats: { storageBucketsTransferred: bucketsOk, storageFilesTransferred: filesOk } };
  }
  
  async exportAuth(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    const users: AuthExport["users"] = [];
    const providers: AuthExport["providers"] = [];
    const policies: AuthExport["policies"] = [];
    const identities: NonNullable<AuthExport["identities"]> = [];
    const warnings: string[] = [];

    // Paginated fetch: no silent 1000-user cap. Stable ORDER BY id paging.
    // A failed page is NEVER reported as complete: partial rows are kept
    // but flagged, so missing accounts/links are always disclosed.
    const fetchAll = async (baseSelect: string, batch = 1000, maxBatches = 200) => {
      const all: Record<string, unknown>[] = [];
      for (let page = 0; page < maxBatches; page++) {
        const res = await serverTransferQuery(
          connectionString,
          `${baseSelect} ORDER BY id LIMIT ${batch} OFFSET ${page * batch}`,
        );
        if (!res.success) {
          return { rows: all, complete: false, error: String(res.error ?? "query failed") };
        }
        const rows = res.data?.rows ?? [];
        all.push(...rows);
        if (rows.length < batch) return { rows: all, complete: true, error: undefined as string | undefined };
      }
      return { rows: all, complete: false, error: "safety cap reached" };
    };

    try {
      // encrypted_password is readable by privileged roles; when it is not,
      // fall back to metadata-only export and warn (users must reset passwords).
      const withPassword = await fetchAll(
        `SELECT id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data, encrypted_password FROM auth.users`,
      );
      let rows = withPassword.rows;
      let passwordless = false;
      if (!withPassword.complete && rows.length === 0) {
        // Total failure (e.g. column not readable): retry metadata-only.
        const fallback = await fetchAll(
          `SELECT id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data FROM auth.users`,
        );
        rows = fallback.rows;
        passwordless = true;
        if (!fallback.complete) {
          warnings.push(`Auth user export incomplete after ${rows.length} user(s): ${fallback.error}`);
        } else {
          warnings.push(
            "Password hashes are not readable with this connection: users migrate metadata-only and must reset passwords to sign in.",
          );
        }
      } else if (!withPassword.complete) {
        // Partial failure mid-pagination: keep what we have, disclose the rest.
        warnings.push(
          withPassword.error === "safety cap reached"
            ? "Auth export hit the 200,000-user safety cap; remaining users were not exported."
            : `Auth user export incomplete after ${rows.length} user(s): ${withPassword.error}; remaining accounts were omitted.`,
        );
      }
      for (const row of rows) {
        users.push({
          id: String(row.id),
          email: String(row.email),
          email_confirmed_at: row.email_confirmed_at != null ? String(row.email_confirmed_at) : undefined,
          created_at: String(row.created_at),
          updated_at: String(row.updated_at),
          raw_user_meta_data: (row.raw_user_meta_data ?? {}) as Record<string, unknown>,
          ...(!passwordless && row.encrypted_password != null
            ? { encrypted_password: String(row.encrypted_password) }
            : {}),
        });
      }
    } catch (error) {
      const msg = `Failed to export auth users: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(msg);
      warnings.push(msg);
    }

    try {
      // Identity links (email/oauth) so imported accounts keep sign-in capability.
      const idRes = await fetchAll(
        `SELECT id, user_id, provider, provider_id, identity_data, created_at, updated_at FROM auth.identities`,
        2000,
      );
      for (const row of idRes.rows) {
        identities.push({
          id: String(row.id),
          user_id: String(row.user_id),
          provider: String(row.provider),
          provider_id: row.provider_id != null ? String(row.provider_id) : undefined,
          identity_data: (row.identity_data ?? {}) as Record<string, unknown>,
          created_at: row.created_at != null ? String(row.created_at) : undefined,
          updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
        });
      }
      if (!idRes.complete) {
        warnings.push(
          `Auth identity export incomplete after ${idRes.rows.length} identit(ies): ${idRes.error}; some sign-in links were omitted.`,
        );
      }
    } catch (error) {
      const msg = `Failed to export auth identities: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(msg);
      warnings.push(msg);
    }
    
    try {
      // Export custom OAuth providers
      const providerConfigs = await fetchAuthProviderConfigs(connectionString);
      
      for (const config of providerConfigs) {
        providers.push({
          id: config.id,
          name: config.name,
          provider: config.provider_type,
          secret: config.client_secret, // Note: This should be handled securely
        });
      }
    } catch (error) {
      console.warn("Failed to export auth providers:", error);
    }
    
    try {
      // Export RLS policies
      const policiesResult = await serverTransferQuery(
        connectionString,
        `SELECT schemaname as schema, tablename as table, policyname as name, pg_get_expr(qual, schemaname||'.'||tablename) as definition
         FROM pg_policies
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         LIMIT 500`
      );
      
      if (policiesResult.success && policiesResult.data?.rows) {
        for (const row of policiesResult.data.rows) {
          const schema = String(row.schema);
          const table = String(row.table);
          const name = String(row.name);
          policies.push({
            id: `${schema}.${table}.${name}`,
            name,
            schema,
            table,
            definition: String(row.definition),
          });
        }
      }
    } catch (error) {
      console.warn("Failed to export RLS policies:", error);
    }
    
    return { users, providers, policies, identities, warnings };
  }

  async importAuth(connectionString: string, data: AuthExport, options: TransferOptions): Promise<ImportOutcome | void> {
    const warnings: string[] = [];
    // User ids this run can vouch for: actually inserted now, or verified
    // to be the SAME account (matching email) on a retry. Identities are
    // linked ONLY for these — never onto a colliding foreign account.
    const vouchedUserIds = new Set<string>();
    let usersOk = 0;
    let identitiesOk = 0;
    let providersOk = 0;

    // Import users WITH password hashes when the export carried them, so
    // password sign-in keeps working on destinations with a compatible auth
    // schema. Users without hashes migrate metadata-only (must reset passwords).
    for (const user of data.users) {
      try {
        const emailConfirmed = user.email_confirmed_at ? escapeLiteral(user.email_confirmed_at) : 'NULL';
        const escapedMeta = escapeLiteral(JSON.stringify(user.raw_user_meta_data || {}));
        const passwordCol = user.encrypted_password != null ? `, encrypted_password` : ``;
        const passwordVal = user.encrypted_password != null ? `, ${escapeLiteral(user.encrypted_password)}` : ``;

        const baseColumns = `id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data${passwordCol}`;
        const baseValues = `${escapeLiteral(user.id)}, ${escapeLiteral(user.email)}, ${emailConfirmed}, ${escapeLiteral(user.created_at)}, ${escapeLiteral(user.updated_at)}, ${escapedMeta}${passwordVal}`;

        const confirmImport = async (withPassword: boolean): Promise<boolean> => {
          const columns = withPassword
            ? baseColumns
            : `id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data`;
          const values = withPassword
            ? baseValues
            : `${escapeLiteral(user.id)}, ${escapeLiteral(user.email)}, ${emailConfirmed}, ${escapeLiteral(user.created_at)}, ${escapeLiteral(user.updated_at)}, ${escapedMeta}`;
          const res = await serverTransferQuery(
            connectionString,
            `INSERT INTO auth.users (${columns})
             VALUES (${values})
             ON CONFLICT (id) DO NOTHING
             RETURNING id;`,
          );
          if (!res.success) {
            // Genuine failures throw so the caller reports them with detail;
            // conflicts (no RETURNING row) fall through to the check below.
            throw new Error(String(res.error ?? "unknown error"));
          }
          if ((res.data?.rows ?? []).length > 0) {
            vouchedUserIds.add(user.id);
            return true;
          }
          // ID already exists on destination: only vouch when it is the SAME
          // account (matching email, e.g. a resumed/repeated transfer).
          // Otherwise the source identity must NOT be linked onto it.
          const existing = await serverTransferQuery(
            connectionString,
            `SELECT email FROM auth.users WHERE id = ${escapeLiteral(user.id)} LIMIT 1;`,
          );
          const existingEmail = existing.success ? String(existing.data?.rows?.[0]?.email ?? "") : "";
          if (existingEmail && existingEmail.toLowerCase() === user.email.toLowerCase()) {
            vouchedUserIds.add(user.id);
            return true;
          }
          warnings.push(
            `User ${user.email} not imported: id ${user.id} already belongs to a different destination account (${existingEmail || "unknown"}); skipped to avoid hijacking it.`,
          );
          return false;
        };

        let imported = false;
        try {
          imported = await confirmImport(true);
        } catch (firstError) {
          // Genuine failure (e.g. hash column missing/unwritable) — retry
          // metadata-only when a hash was included; collisions were already
          // reported inside confirmImport and never reach here.
          if (user.encrypted_password != null) {
            try {
              imported = await confirmImport(false);
              if (imported) {
                warnings.push(`User ${user.email} migrated without password hash (destination rejected it); password reset required.`);
              }
            } catch (retryError) {
              warnings.push(`Failed to import user ${user.email}: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
            }
          } else {
            warnings.push(`Failed to import user ${user.email}: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
          }
        }
        if (imported) usersOk++;
      } catch (error) {
        warnings.push(`Failed to import user ${user.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Identity links restore sign-in capability — but ONLY for vouched
    // users. Linking a source identity onto an unvouched (foreign)
    // destination account would hand the source identity access to it.
    for (const identity of data.identities ?? []) {
      if (!vouchedUserIds.has(identity.user_id)) {
        warnings.push(
          `Identity for user ${identity.user_id} not linked: its account was not imported by this transfer.`,
        );
        continue;
      }
      try {
        const created = identity.created_at ? escapeLiteral(identity.created_at) : "NOW()";
        const updated = identity.updated_at ? escapeLiteral(identity.updated_at) : "NOW()";
        const result = await serverTransferQuery(
          connectionString,
          `INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
           VALUES (${escapeLiteral(identity.id)}, ${escapeLiteral(identity.user_id)}, ${escapeLiteral(identity.provider)},
                   ${identity.provider_id != null ? escapeLiteral(identity.provider_id) : "NULL"},
                   ${escapeLiteral(JSON.stringify(identity.identity_data ?? {}))},
                   ${created}, ${updated})
           ON CONFLICT (id) DO NOTHING;`,
        );
        if (result.success) identitiesOk++;
        else warnings.push(`Failed to import identity for user ${identity.user_id}: ${String(result.error ?? "unknown error")}`);
      } catch (error) {
        warnings.push(`Failed to import identity for user ${identity.user_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (data.users.length > 0) {
      console.log(`Auth import: ${usersOk}/${data.users.length} users, ${identitiesOk}/${data.identities?.length ?? 0} identities restored.`);
    }

    // Import custom OAuth providers. Column names must match
    // AuthProviderConfig (provider_type / client_secret) — writing to the
    // legacy provider/secret columns fails and previously went unchecked.
    for (const provider of data.providers) {
      try {
        const importProviderQuery = `
          INSERT INTO auth.custom_oauth_providers (id, name, provider_type, client_secret)
          VALUES (${escapeLiteral(provider.id)}, ${escapeLiteral(provider.name)}, ${escapeLiteral(provider.provider)}, ${escapeLiteral(provider.secret)})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            provider_type = EXCLUDED.provider_type,
            client_secret = EXCLUDED.client_secret;
        `;

        const result = await serverTransferQuery(connectionString, importProviderQuery);
        if (!result.success) {
          warnings.push(`Failed to import provider ${provider.name}: ${String(result.error ?? "unknown error")}`);
        } else {
          providersOk++;
        }
      } catch (error) {
        warnings.push(`Failed to import provider ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { warnings, stats: { authUsersTransferred: usersOk, authProvidersTransferred: providersOk } };
  }
  
  async exportFunctions(connectionString: string, options: TransferOptions): Promise<FunctionsExport> {
    const warnings: string[] = [];
    const { creds, warning: credsWarning } = await resolveSupabaseApiCreds(connectionString);
    if (!creds) {
      return {
        functions: [],
        warnings: [credsWarning ?? "Edge functions require a supabase-mgmt connection; nothing exported."],
      };
    }
    const listed = await listSupabaseFunctions(creds);
    if ("error" in listed) {
      return { functions: [], warnings: [`Failed to list edge functions: ${listed.error}`] };
    }
    const functions: FunctionsExport["functions"] = [];
    for (const fn of listed.functions) {
      const bodyRes = await getSupabaseFunctionBody(creds, fn.slug);
      if ("error" in bodyRes) {
        warnings.push(`Function ${fn.slug}: source not readable (${bodyRes.error}); skipped.`);
        continue;
      }
      const files = [{ path: "index.ts", content: bodyRes.body }];
      functions.push({
        slug: fn.slug,
        provider: "supabase",
        verifyJwt: fn.verifyJwt,
        files,
        diffs: buildCompatDiffs(fn.slug, "supabase", files),
      });
    }
    if (listed.functions.length === 0) warnings.push("No edge functions found on source.");
    return { functions, warnings };
  }

  async importFunctions(connectionString: string, data: FunctionsExport, options: TransferOptions) {
    const warnings: string[] = [];
    let deployed = 0;
    // Same-family redeploy needs no porting: deploy sources verbatim.
    // Foreign sources deploy their pre-ported transform when the diff
    // builder produced one, else verbatim with a warning.
    const { creds, warning: credsWarning } = await resolveSupabaseApiCreds(connectionString);
    if (!creds) {
      if (data.functions.length > 0) {
        warnings.push(
          `Edge functions not deployed: destination has no management token${credsWarning ? ` (${credsWarning})` : ""}. Sources are preserved in the transfer package — deploy manually.`,
        );
      }
      return { warnings, stats: { functionsTransferred: 0 } };
    }
    for (const fn of data.functions) {
      try {
        const useFiles =
          fn.provider === "supabase"
            ? fn.files
            : (fn.diffs.find((d) => d.targetProvider === "supabase")?.transformedFiles ?? fn.files);
        if (fn.provider !== "supabase") {
          warnings.push(`Function ${fn.slug}: deploying auto-ported draft — review its compat diff first; runtime APIs may differ.`);
        }
        const entry = useFiles.find((f) => /index\.[tj]s$/.test(f.path)) ?? useFiles[0];
        if (!entry) {
          warnings.push(`Function ${fn.slug}: no deployable file; skipped.`);
          continue;
        }
        const res = await deploySupabaseFunction(creds, fn.slug, entry.content, fn.verifyJwt);
        if ("ok" in res) deployed++;
        else warnings.push(`Function ${fn.slug}: deploy failed (${res.error}).`);
      } catch (error) {
        warnings.push(`Function ${fn.slug}: deploy failed (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    return { warnings, stats: { functionsTransferred: deployed } };
  }

  async exportSettings(connectionString: string, options: TransferOptions): Promise<SettingsExport> {    const projectSettings: Record<string, unknown> = {};
    
    try {
      // Export various project settings that might be stored in the database
      const settingsResult = await serverTransferQuery(
        connectionString,
        `SELECT * FROM public.settings LIMIT 1`
      );
      
      if (settingsResult.success && settingsResult.data?.rows?.[0]) {
        Object.assign(projectSettings, settingsResult.data.rows[0]);
      }
    } catch (error) {
      // Settings table might not exist, that's okay
    }
    
    return {
      projectSettings,
    };
  }
  
  async importSettings(connectionString: string, data: SettingsExport, options: TransferOptions): Promise<void> {
    // Import project settings
    if (Object.keys(data.projectSettings).length > 0) {
      try {
        // This would need to be adapted based on actual settings structure
        console.log("Settings import:", Object.keys(data.projectSettings).length, "settings");
      } catch (error) {
        console.warn("Failed to import settings:", error);
      }
    }
  }
  
  async getProjectInfo(connectionString: string): Promise<{ name: string; id: string }> {
    // For Supabase, extract project ref from connection string
    const match = connectionString.match(/supabase-mgmt:\/\/([^\/?]+)/i);
    if (match?.[1]) {
      return { name: match[1], id: match[1] };
    }
    
    // Fallback to database name
    try {
      const result = await serverTransferQuery(connectionString, "SELECT current_database()");
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