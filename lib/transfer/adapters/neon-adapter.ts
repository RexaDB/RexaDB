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
import { applyDataSql, exportTableDataSql, qualifiedTable } from "../transfer-sql";
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
    let dataSql = "";
    
    if (tablesResult.success && tablesResult.data?.rows) {
      for (const row of tablesResult.data.rows) {
        const tableSchema = String(row.table_schema);
        const tableName = String(row.table_name);
        const tableFullName = `${tableSchema}.${tableName}`;
        tables.push(tableFullName);

        // Get row count for each table
        const countResult = await runQuery(
          effectiveConnectionString,
          `SELECT COUNT(*) as count FROM ${qualifiedTable(tableSchema, tableName)}`
        );

        if (countResult.success && countResult.data?.rows?.[0]) {
          rowCounts[tableFullName] = Number(countResult.data.rows[0].count) || 0;
        }

        // Export row data for reasonably-sized tables (see transfer-sql).
        const exported = await exportTableDataSql(
          runQuery,
          effectiveConnectionString,
          tableSchema,
          tableName,
          rowCounts[tableFullName] || 0,
        );
        dataSql += exported.sql;
      }
    }
    
    return {
      schemaSql,
      dataSql: dataSql || undefined,
      tables,
      rowCounts,
    };
  }
  
  async importDatabase(connectionString: string, data: DatabaseExport, options: TransferOptions): Promise<void> {
    const { resetAndApplySql } = await import("@/lib/db/export-helpers");
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);

    // Schema apply is destructive and transactional (rolls back on failure).
    await resetAndApplySql(effectiveConnectionString, data.schemaSql);

    // Row data: surface failures instead of silently succeeding.
    if (data.dataSql) {
      const { failed, errors } = await applyDataSql(runQuery, effectiveConnectionString, data.dataSql);
      if (failed > 0) {
        throw new Error(`Failed to import ${failed} data statement(s): ${errors.slice(0, 3).join(" | ")}`);
      }
    }
  }
  
  // Neon doesn't have built-in storage like Supabase, but users might use external storage
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    // Neon doesn't have built-in storage, return empty
    console.warn("Neon storage export: Neon doesn't have built-in storage, skipping storage transfer");
    return { buckets: [], files: [] };
  }
  
  async importStorage?(connectionString: string, data: StorageExport, options: TransferOptions): Promise<void> {
    // Neon doesn't have built-in storage, but we could create tables to simulate it
    if (data.buckets.length > 0 || data.files.length > 0) {
      console.warn(`Neon storage import: ${data.buckets.length} buckets and ${data.files.length} files were not transferred because Neon doesn't have built-in storage`);
    }
  }
  
  // Neon doesn't have built-in auth like Supabase
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    // Neon doesn't have built-in auth, return empty
    console.warn("Neon auth export: Neon doesn't have built-in auth, skipping auth transfer");
    return { users: [], providers: [], policies: [] };
  }
  
  async importAuth?(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void> {
    // Neon doesn't have built-in auth, but we could create tables to simulate it
    if (data.users.length > 0 || data.providers.length > 0) {
      console.warn(`Neon auth import: ${data.users.length} users and ${data.providers.length} providers were not transferred because Neon doesn't have built-in auth`);
    }
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