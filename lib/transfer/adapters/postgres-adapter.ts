/**
 * Generic PostgreSQL adapter for transfer operations
 * Handles standard PostgreSQL databases that aren't Supabase or Neon
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

export class PostgresAdapter implements ProviderAdapter {
  type = "postgres" as const;
  
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
  
  // Generic Postgres doesn't have built-in storage
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    return { buckets: [], files: [] };
  }
  
  async importStorage?(connectionString: string, data: StorageExport, options: TransferOptions): Promise<void> {
    console.log("Generic Postgres storage import: No built-in storage, skipping");
  }
  
  // Generic Postgres doesn't have built-in auth like Supabase
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    return { users: [], providers: [], policies: [] };
  }
  
  async importAuth?(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void> {
    console.log("Generic Postgres auth import: No built-in auth, skipping");
  }
  
  async exportSettings(connectionString: string, options: TransferOptions): Promise<SettingsExport> {
    const projectSettings: Record<string, unknown> = {};
    
    try {
      // Get some basic Postgres settings
      const settingsResult = await runQuery(
        connectionString,
        `SELECT name, setting FROM pg_settings 
         WHERE name IN ('server_version', 'timezone', 'standard_conforming_strings') 
         LIMIT 10`
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
    // Generic Postgres doesn't have much in the way of importable settings
    console.log("Generic Postgres settings import: Limited settings support");
  }
  
  async getProjectInfo(connectionString: string): Promise<{ name: string; id: string }> {
    try {
      // Extract database name from connection string
      const url = new URL(connectionString.replace(/^postgres:\/\//, "postgresql://"));
      const dbName = url.pathname.slice(1) || "postgres";
      
      return { name: dbName, id: dbName };
    } catch {
      // Fallback
      try {
        const result = await runQuery(connectionString, "SELECT current_database()");
        if (result.success && result.data?.rows?.[0]) {
          return { name: result.data.rows[0].current_database, id: result.data.rows[0].current_database };
        }
      } catch {
        // Ignore error
      }
    }
    
    return { name: "Unknown", id: "unknown" };
  }
}