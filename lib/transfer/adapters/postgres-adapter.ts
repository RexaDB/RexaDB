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
import { applyDataSql, exportTableDataSql, qualifiedTable } from "../transfer-sql";

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
    let dataSql = "";
    
    if (tablesResult.success && tablesResult.data?.rows) {
      for (const row of tablesResult.data.rows) {
        const tableSchema = String(row.table_schema);
        const tableName = String(row.table_name);
        const tableFullName = `${tableSchema}.${tableName}`;
        tables.push(tableFullName);

        // Get row count for each table
        const countResult = await runQuery(
          connectionString,
          `SELECT COUNT(*) as count FROM ${qualifiedTable(tableSchema, tableName)}`
        );

        if (countResult.success && countResult.data?.rows?.[0]) {
          rowCounts[tableFullName] = Number(countResult.data.rows[0].count) || 0;
        }

        // Export row data for reasonably-sized tables (see transfer-sql).
        const exported = await exportTableDataSql(
          runQuery,
          connectionString,
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

    // Destructive by design (drops + recreates destination schemas — the
    // wizard confirm step requires an explicit backup acknowledgement) and
    // transactional: a schema-apply failure rolls back instead of erasing.
    try {
      await resetAndApplySql(connectionString, data.schemaSql);

      // Row data: surface failures instead of silently succeeding.
      if (data.dataSql) {
        const { failed, errors } = await applyDataSql(runQuery, connectionString, data.dataSql);
        if (failed > 0) {
          throw new Error(`Failed to import ${failed} data statement(s): ${errors.slice(0, 3).join(" | ")}`);
        }
      }
    } catch (error) {
      console.error("Failed to import database:", error);
      throw new Error(`Database import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Generic Postgres doesn't have built-in storage
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    console.warn("Postgres storage export: generic Postgres has no built-in storage, skipping storage transfer");
    return { buckets: [], files: [] };
  }

  async importStorage?(connectionString: string, data: StorageExport, options: TransferOptions): Promise<void> {
    if (data.buckets.length > 0 || data.files.length > 0) {
      console.warn(`Postgres storage import: ${data.buckets.length} buckets and ${data.files.length} files were not transferred because generic Postgres has no built-in storage`);
    }
  }

  // Generic Postgres doesn't have built-in auth like Supabase
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    console.warn("Postgres auth export: generic Postgres has no built-in auth, skipping auth transfer");
    return { users: [], providers: [], policies: [] };
  }

  async importAuth?(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void> {
    if (data.users.length > 0 || data.providers.length > 0) {
      console.warn(`Postgres auth import: ${data.users.length} users and ${data.providers.length} providers were not transferred because generic Postgres has no built-in auth`);
    }
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