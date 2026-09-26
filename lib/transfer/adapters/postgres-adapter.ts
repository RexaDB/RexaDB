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
  FunctionsExport,
  ImportOutcome,
} from "../transfer-types";
import { runPgDumpSchemaOnly } from "@/lib/db/export-helpers";
import { exportTableDataSql, qualifiedTable } from "../transfer-sql";
import { serverTransferQuery } from "../transfer-server-query";

export class PostgresAdapter implements ProviderAdapter {
  type = "postgres" as const;
  
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
          connectionString,
          `SELECT COUNT(*) as count FROM ${qualifiedTable(tableSchema, tableName)}`
        );

        if (countResult.success && countResult.data?.rows?.[0]) {
          rowCounts[tableFullName] = Number(countResult.data.rows[0].count) || 0;
        }

        // Export row data for reasonably-sized tables; the rest migrate
        // schema-only and are reported so stats stay honest.
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

    // Destructive by design (drops + recreates destination schemas — the
    // wizard confirm step requires an explicit backup acknowledgement) and
    // fully transactional including FK-ordered row data: any failure rolls
    // back instead of leaving a partial destination.
    try {
      const { sanitizeExtensionsForDestination } = await import("../schema-dump-sql");
      const sanitized = await sanitizeExtensionsForDestination(serverTransferQuery, connectionString, data.schemaSql);
      const applied = await resetAndApplySql(connectionString, sanitized.sql, data.dataSql, serverTransferQuery);
      const allWarnings = [...sanitized.warnings, ...(applied?.warnings ?? [])];
      if (allWarnings.length > 0) return { warnings: allWarnings };
    } catch (error) {
      console.error("Failed to import database:", error);
      throw new Error(`Database import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Generic Postgres exposes no Supabase-compatible storage over SQL.
  // There is intentionally NO importStorage: the service reports exported
  // storage as skipped with a user-visible warning instead of silently
  // discarding it.
  async exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport> {
    return {
      buckets: [],
      files: [],
      warnings: ["Generic Postgres exposes no Supabase-compatible storage over SQL: nothing to export."],
    };
  }

  // Generic Postgres has no GoTrue-compatible auth schema. There is
  // intentionally NO importAuth — see importStorage note above.
  async exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport> {
    return {
      users: [],
      providers: [],
      policies: [],
      warnings: ["Generic Postgres has no GoTrue-compatible auth schema: nothing to export."],
    };
  }

  async exportFunctions?(connectionString: string, options: TransferOptions): Promise<FunctionsExport> {
    return {
      functions: [],
      warnings: ["Generic Postgres has no edge-functions platform: nothing to export."],
    };
  }
  
  async exportSettings(connectionString: string, options: TransferOptions): Promise<SettingsExport> {
    const projectSettings: Record<string, unknown> = {};
    
    try {
      // Get some basic Postgres settings
      const settingsResult = await serverTransferQuery(
        connectionString,
        `SELECT name, setting FROM pg_settings 
         WHERE name IN ('server_version', 'timezone', 'standard_conforming_strings') 
         LIMIT 10`
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
        const result = await serverTransferQuery(connectionString, "SELECT current_database()");
        if (result.success && result.data?.rows?.[0]) {
          const dbName = String(result.data.rows[0].current_database);
          return { name: dbName, id: dbName };
        }
      } catch {
        // Ignore error
      }
    }
    
    return { name: "Unknown", id: "unknown" };
  }
}