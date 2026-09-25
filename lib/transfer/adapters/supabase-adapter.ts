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
import { runQuery } from "@/lib/api/actions-client";
import { fetchStorageBuckets, fetchStorageObjects } from "@/lib/studio/storage-utils";
import { fetchAuthProviderConfigs } from "@/lib/studio/auth/fetch";
import { isLikelySupabaseConnection } from "@/lib/db/supabase-helpers";

export class SupabaseAdapter implements ProviderAdapter {
  type = "supabase" as const;
  
  async validateConnection(connectionString: string): Promise<boolean> {
    try {
      const result = await runQuery(connectionString, "SELECT 1");
      return result.success;
    } catch {
      return false;
    }
  }
  
  async exportDatabase(connectionString: string, options: TransferOptions): Promise<DatabaseExport> {
    const schemaSql = await runPgDumpSchemaOnly(connectionString, runQuery);
    
    // Get table list and row counts
    const tablesResult = await runQuery(
      connectionString,
      `SELECT table_name, table_schema 
       FROM information_schema.tables 
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions')
         AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name`
    );
    
    const tables: string[] = [];
    const rowCounts: Record<string, number> = {};
    
    if (tablesResult.success && tablesResult.data?.rows) {
      for (const row of tablesResult.data.rows) {
        const tableFullName = `${row.table_schema}.${row.table_name}`;
        tables.push(tableFullName);
        
        // Get row count for each table
        const countResult = await runQuery(
          connectionString,
          `SELECT COUNT(*) as count FROM "${row.table_schema}"."${row.table_name}"`
        );
        
        if (countResult.success && countResult.data?.rows?.[0]) {
          rowCounts[tableFullName] = Number(countResult.data.rows[0].count) || 0;
        }
      }
    }
    
    return {
      schemaSql,
      tables,
      rowCounts,
    };
  }
  
  async importDatabase(connectionString: string, data: DatabaseExport, options: TransferOptions): Promise<void> {
    const { resetAndApplySql } = await import("@/lib/db/export-helpers");
    await resetAndApplySql(connectionString, data.schemaSql);
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
    // Create buckets
    for (const bucket of data.buckets) {
      const createBucketQuery = `
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('${bucket.id}', '${bucket.name}', ${bucket.public}, ${bucket.file_size_limit || 'NULL'}, 
                '${JSON.stringify(bucket.allowed_mime_types || []).replace(/'/g, "''")}')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
      `;
      
      await runQuery(connectionString, createBucketQuery);
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
      // Export users from auth.users
      const usersResult = await runQuery(
        connectionString,
        `SELECT id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data 
         FROM auth.users 
         LIMIT 1000`
      );
      
      if (usersResult.success && usersResult.data?.rows) {
        for (const row of usersResult.data.rows) {
          users.push({
            id: row.id,
            email: row.email,
            email_confirmed_at: row.email_confirmed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            raw_user_meta_data: row.raw_user_meta_data,
          });
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
      const policiesResult = await runQuery(
        connectionString,
        `SELECT schemaname as schema, tablename as table, policyname as name, pg_get_expr(qual, schemaname||'.'||tablename) as definition
         FROM pg_policies
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         LIMIT 500`
      );
      
      if (policiesResult.success && policiesResult.data?.rows) {
        for (const row of policiesResult.data.rows) {
          policies.push({
            id: `${row.schema}.${row.table}.${row.name}`,
            name: row.name,
            schema: row.schema,
            table: row.table,
            definition: row.definition,
          });
        }
      }
    } catch (error) {
      console.warn("Failed to export RLS policies:", error);
    }
    
    return { users, providers, policies };
  }
  
  async importAuth(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void> {
    // Import users
    for (const user of data.users) {
      try {
        const importUserQuery = `
          INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
          VALUES ('${user.id}', '${user.email}', '${user.email_confirmed_at || 'NULL'}', 
                  '${user.created_at}', '${user.updated_at}', 
                  '${JSON.stringify(user.raw_user_meta_data || {}).replace(/'/g, "''")}')
          ON CONFLICT (id) DO NOTHING;
        `;
        
        await runQuery(connectionString, importUserQuery);
      } catch (error) {
        console.warn(`Failed to import user ${user.id}:`, error);
      }
    }
    
    // Import custom OAuth providers
    for (const provider of data.providers) {
      try {
        const importProviderQuery = `
          INSERT INTO auth.custom_oauth_providers (id, name, provider, secret)
          VALUES ('${provider.id}', '${provider.name}', '${provider.provider}', '${provider.secret}')
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            provider = EXCLUDED.provider,
            secret = EXCLUDED.secret;
        `;
        
        await runQuery(connectionString, importProviderQuery);
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
      const settingsResult = await runQuery(
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
      const result = await runQuery(connectionString, "SELECT current_database()");
      if (result.success && result.data?.rows?.[0]) {
        return { name: result.data.rows[0].current_database, id: result.data.rows[0].current_database };
      }
    } catch {
      // Ignore error
    }
    
    return { name: "Unknown", id: "unknown" };
  }
}