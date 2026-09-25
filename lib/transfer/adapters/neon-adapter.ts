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
} from "../transfer-types";
import { runPgDumpSchemaOnly } from "@/lib/db/export-helpers";
import { runQuery } from "@/lib/api/actions-client";
import { resolveEffectiveConnectionString } from "@/lib/db/neon-cli-client";

export class NeonAdapter implements ProviderAdapter {
  type = "neon" as const;
  
  async validateConnection(connectionString: string): Promise<boolean> {
    try {
      const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
      const result = await runQuery(effectiveConnectionString, "SELECT 1");
      return result.success;
    } catch {
      return false;
    }
  }
  
  async exportDatabase(connectionString: string, options: TransferOptions): Promise<DatabaseExport> {
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
    const schemaSql = await runPgDumpSchemaOnly(effectiveConnectionString, runQuery);
    
    // Get table list and row counts
    const tablesResult = await runQuery(
      effectiveConnectionString,
      `SELECT table_name, table_schema 
       FROM information_schema.tables 
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
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
          effectiveConnectionString,
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
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
    await resetAndApplySql(effectiveConnectionString, data.schemaSql);
  }
  
  // Neon doesn't have built-in storage like Supabase, but users might use external storage
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    // Neon doesn't have built-in storage, return empty
    return { buckets: [], files: [] };
  }
  
  async importStorage?(connectionString: string, data: StorageExport, options: TransferOptions): Promise<void> {
    // Neon doesn't have built-in storage, but we could create tables to simulate it
    console.log("Neon storage import: Neon doesn't have built-in storage, skipping");
  }
  
  // Neon doesn't have built-in auth like Supabase
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    // Neon doesn't have built-in auth, return empty
    return { users: [], providers: [], policies: [] };
  }
  
  async importAuth?(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void> {
    // Neon doesn't have built-in auth, but we could create tables to simulate it
    console.log("Neon auth import: Neon doesn't have built-in auth, skipping");
  }
  
  async exportSettings(connectionString: string, options: TransferOptions): Promise<SettingsExport> {
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
    const projectSettings: Record<string, unknown> = {};
    
    try {
      // Try to get any Neon-specific settings
      const settingsResult = await runQuery(
        effectiveConnectionString,
        `SELECT * FROM pg_settings WHERE name LIKE '%neon%' LIMIT 10`
      );
      
      if (settingsResult.success && settingsResult.data?.rows) {
        for (const row of settingsResult.data.rows) {
          projectSettings[row.name] = row.setting;
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
  
  async getProjectInfo(connectionString: string): Promise<{ name: string; id: string }> {
    try {
      const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);
      
      // Extract project ID from Neon connection string
      const match = effectiveConnectionString.match(/neon:\/\/([^:]+)@([^\/.]+)\.([^\/]+)/);
      if (match) {
        return { name: match[2], id: match[2] };
      }
      
      // Fallback to database name
      const result = await runQuery(effectiveConnectionString, "SELECT current_database()");
      if (result.success && result.data?.rows?.[0]) {
        return { name: result.data.rows[0].current_database, id: result.data.rows[0].current_database };
      }
    } catch {
      // Ignore error
    }
    
    return { name: "Unknown", id: "unknown" };
  }
}