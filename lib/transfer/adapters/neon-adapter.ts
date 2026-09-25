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
import { exportTableDataSql, qualifiedTable } from "../transfer-sql";
import { serverTransferQuery } from "../transfer-server-query";
import { resolveEffectiveConnectionString } from "@/lib/db/neon-cli-client";

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

  async importDatabase(connectionString: string, data: DatabaseExport, options: TransferOptions): Promise<void> {
    const { resetAndApplySql } = await import("@/lib/db/export-helpers");
    const effectiveConnectionString = await resolveEffectiveConnectionString(connectionString);

    // Single transaction (drops + schema + FK-ordered row data): failure
    // rolls everything back instead of leaving a partial destination.
    await resetAndApplySql(effectiveConnectionString, data.schemaSql, data.dataSql);
  }
  
  // Neon Object Storage holds bytes outside Postgres, so there is nothing
  // SQL-reachable to export here. There is intentionally NO importStorage:
  // the service reports Supabase-shaped storage as skipped with a
  // user-visible warning instead of silently discarding it.
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    return {
      buckets: [],
      files: [],
      warnings: ["Neon Object Storage is not reachable over SQL: no storage metadata to export."],
    };
  }

  // Neon Auth lives in neon_auth tables and migrates with the database
  // transfer — not through the Supabase-shaped auth component. There is
  // intentionally NO importAuth — see importStorage note above.
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    return {
      users: [],
      providers: [],
      policies: [],
      warnings: ["Neon Auth migrates with the database transfer (neon_auth tables); the Supabase-shaped auth export is empty."],
    };
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