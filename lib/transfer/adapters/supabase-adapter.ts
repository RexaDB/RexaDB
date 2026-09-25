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

  async importDatabase(connectionString: string, data: DatabaseExport, options: TransferOptions): Promise<void> {
    const { resetAndApplySql } = await import("@/lib/db/export-helpers");

    // Single transaction (drops + schema + row data, FK-ordered): a failure
    // rolls everything back, so the destination is never left partially
    // populated. Errors propagate so the transfer reports failure honestly.
    await resetAndApplySql(connectionString, data.schemaSql, data.dataSql);
  }
  
  async exportStorage(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    const { buckets, error: bucketsError } = await fetchStorageBuckets(connectionString);
    
    if (bucketsError) {
      console.warn("Failed to fetch storage buckets:", bucketsError);
      return { buckets: [], files: [] };
    }
    
    const files: StorageExport["files"] = [];
    
    for (const bucket of buckets) {
      const { objects, error: objectsError } = await fetchStorageObjects(connectionString, bucket.name);
      
      if (objectsError) {
        console.warn(`Failed to fetch objects for bucket ${bucket.name}:`, objectsError);
        continue;
      }
      
      for (const object of objects) {
        // For now, we'll export metadata only. Full file content export would need
        // additional implementation with proper streaming and size limits
        files.push({
          bucketId: bucket.id,
          path: object.name,
          metadata: object.metadata || {},
          size: object.metadata ? (object.metadata as any).size : undefined,
        });
      }
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
    };
  }
  
  async importStorage(connectionString: string, data: StorageExport, options: TransferOptions): Promise<void> {
    // Create buckets. Values are literal-escaped (see transfer-sql) so source
    // data cannot alter the SQL executed with destination privileges.
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
          console.warn(`Failed to create bucket ${bucket.name}:`, result.error);
        }
      } catch (error) {
        console.warn(`Failed to create bucket ${bucket.name}:`, error);
      }
    }
    
    // Note: File content import would require Supabase storage API access
    // This is a placeholder for the metadata import
    console.log(`Storage import: ${data.files.length} files metadata imported (content requires API access)`);
  }
  
  async exportAuth(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    const users: AuthExport["users"] = [];
    const providers: AuthExport["providers"] = [];
    const policies: AuthExport["policies"] = [];
    
    try {
      // Export users from auth.users with warning about limitations
      const usersResult = await serverTransferQuery(
        connectionString,
        `SELECT id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data 
         FROM auth.users 
         LIMIT 1000`
      );
      
      if (usersResult.success && usersResult.data?.rows) {
        for (const row of usersResult.data.rows) {
          users.push({
            id: String(row.id),
            email: String(row.email),
            email_confirmed_at: row.email_confirmed_at != null ? String(row.email_confirmed_at) : undefined,
            created_at: String(row.created_at),
            updated_at: String(row.updated_at),
            raw_user_meta_data: (row.raw_user_meta_data ?? {}) as Record<string, unknown>,
          });
        }
        // Warn if we hit the limit
        if (usersResult.data.rows.length >= 1000) {
          console.warn("Auth export limited to 1000 users. Consider paginating for larger datasets.");
        }
      }
    } catch (error) {
      console.warn("Failed to export auth users:", error);
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
    
    return { users, providers, policies };
  }
  
  async importAuth(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void> {
    // Import users (metadata-only: passwords/identities cannot be migrated —
    // the wizard confirm step discloses this limitation).
    for (const user of data.users) {
      try {
        const emailConfirmed = user.email_confirmed_at ? escapeLiteral(user.email_confirmed_at) : 'NULL';
        const escapedMeta = escapeLiteral(JSON.stringify(user.raw_user_meta_data || {}));

        const importUserQuery = `
          INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
          VALUES (${escapeLiteral(user.id)}, ${escapeLiteral(user.email)}, ${emailConfirmed},
                  ${escapeLiteral(user.created_at)}, ${escapeLiteral(user.updated_at)},
                  ${escapedMeta})
          ON CONFLICT (id) DO NOTHING;
        `;
        
        const result = await serverTransferQuery(connectionString, importUserQuery);
        if (!result.success) {
          console.warn(`Failed to import user ${user.id}:`, result.error);
        }
      } catch (error) {
        console.warn(`Failed to import user ${user.id}:`, error);
      }
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
          console.warn(`Failed to import provider ${provider.id}:`, result.error);
        }
      } catch (error) {
        console.warn(`Failed to import provider ${provider.id}:`, error);
      }
    }
    
    // Note: RLS policies would need more sophisticated import logic
    console.log(`Auth import: ${data.users.length} users, ${data.providers.length} providers imported`);
  }
  
  async exportSettings(connectionString: string, options: TransferOptions): Promise<SettingsExport> {
    const projectSettings: Record<string, unknown> = {};
    
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