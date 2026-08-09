import {
  normalizePgConnectionString, isPostgresConnection, getPgPassword, getPgHost, getPgPort, getPgDatabase, getPgUsername, getPgSslConfig,
} from "./pg-connection";
import { resolvePgDumpBinary } from "./pg-dump";
import { isLikelySupabaseConnection, isSupabaseExcludedSchema } from "./supabase-helpers";

function encodeCsvCell(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function decodeCsvCell(value: string) {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/""/g, "\"");
  }
  return value;
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map(decodeCsvCell);
}

function splitForeignKeysFromSchemaSql(schemaSql: string): { schemaWithoutForeignKeys: string; foreignKeySql: string } {
  const lines = schemaSql.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  const foreignKeys: string[] = [];

  for (const line of lines) {
    const normalized = line.trim().toUpperCase();
    const isForeignKeyConstraint =
      normalized.startsWith("ALTER TABLE ")
      && normalized.includes(" ADD CONSTRAINT ")
      && normalized.includes(" FOREIGN KEY ");

    if (isForeignKeyConstraint) {
      foreignKeys.push(line);
    } else {
      kept.push(line);
    }
  }

  return {
    schemaWithoutForeignKeys: kept.join("\n").trim(),
    foreignKeySql: foreignKeys.join("\n").trim(),
  };
}

async function getFullSqlSnapshot(
  connectionString: string,
  runQuery: (connectionString: string, query: string) => Promise<{ success: boolean; data?: { rows: any[] }; error?: string }>
) {
  if (!isPostgresConnection(connectionString)) {
    return { success: false, error: "SQL snapshot export is supported only for PostgreSQL connections." };
  }

  try {
    const schemaSql = await runPgDumpSchemaOnly(connectionString, runQuery);
    const { schemaWithoutForeignKeys, foreignKeySql } = splitForeignKeysFromSchemaSql(schemaSql);
    const dataSql = "";
    const fullSql = `${schemaWithoutForeignKeys}\n${foreignKeySql ? `\n-- Foreign keys\n${foreignKeySql}` : ""}\n`;
    return { success: true, schemaSql, dataSql, fullSql };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

function stripRexaDbParams(connectionString: string) {
  try {
    const url = new URL(normalizePgConnectionString(connectionString));
    const customKeys = [
      "rexadb_keychain_db",
      "rexadb_ssh_mode",
      "rexadb_ssh_host",
      "rexadb_ssh_port",
      "rexadb_ssh_user",
      "rexadb_ssh_auth",
      "rexadb_ssh_keychain",
      "rexadb_ssh_password",
      "rexadb_ssh_private_key",
    ];
    for (const key of customKeys) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

async function getAllowedSchemasForDump(
  connectionString: string,
  runQuery: (connectionString: string, query: string) => Promise<{ success: boolean; data?: { rows: any[] }; error?: string }>
) {
  const res = await runQuery(
    connectionString,
    `SELECT schema_name
     FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_catalog','information_schema')
       AND schema_name NOT LIKE 'pg_%'
       AND has_schema_privilege(schema_name, 'USAGE')
     ORDER BY schema_name;`
  );
  if (!res.success || !res.data) return [];
  const isSupabase = isLikelySupabaseConnection(connectionString);
  return res.data.rows
    .map((row: any) => String(row.schema_name || "").trim())
    .filter(Boolean)
    .filter((schema) => !isSupabase || !isSupabaseExcludedSchema(schema));
}

function applySupabaseDumpTransforms(input: string, excludedSchemasPattern: string) {
  const excludedRegex = excludedSchemasPattern;
  const rules: Array<{ re: RegExp; replace: string }> = [
    { re: /^\\(un)?restrict .*$/gim, replace: "-- $&" },
    { re: /^CREATE SCHEMA "/gim, replace: 'CREATE SCHEMA IF NOT EXISTS "' },
    { re: /^CREATE TABLE "/gim, replace: 'CREATE TABLE IF NOT EXISTS "' },
    { re: /^CREATE SEQUENCE "/gim, replace: 'CREATE SEQUENCE IF NOT EXISTS "' },
    { re: /^CREATE VIEW "/gim, replace: 'CREATE OR REPLACE VIEW "' },
    { re: /^CREATE FUNCTION "/gim, replace: 'CREATE OR REPLACE FUNCTION "' },
    { re: /^CREATE TRIGGER "/gim, replace: 'CREATE OR REPLACE TRIGGER "' },
    { re: /^CREATE PUBLICATION "supabase_realtime/gim, replace: "-- $&" },
    { re: /^CREATE EVENT TRIGGER /gim, replace: "-- $&" },
    { re: /^\s*WHEN TAG IN /gim, replace: "-- $&" },
    { re: /^\s*EXECUTE FUNCTION /gim, replace: "-- $&" },
    { re: /^ALTER EVENT TRIGGER /gim, replace: "-- $&" },
    { re: /^ALTER PUBLICATION "supabase_realtime_/gim, replace: "-- $&" },
    { re: /^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /gim, replace: "-- $&" },
    { re: /^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/gim, replace: "-- $&" },
    { re: /^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/gim, replace: "-- $&" },
    { re: new RegExp(`^GRANT (.+) ON (.+) \"(${excludedRegex})`, "gim"), replace: "-- $&" },
    { re: new RegExp(`^REVOKE (.+) ON (.+) \"(${excludedRegex})`, "gim"), replace: "-- $&" },
    { re: /^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/gim, replace: '$1;' },
    { re: /^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/gim, replace: '$1;' },
    { re: /^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/gim, replace: '$1;' },
    { re: /^COMMENT ON EXTENSION (.+)/gim, replace: "-- $&" },
    { re: /^CREATE POLICY "cron_job_/gim, replace: "-- $&" },
    { re: /^ALTER TABLE "cron"/gim, replace: "-- $&" },
    { re: /^SET transaction_timeout = 0;/gim, replace: "-- $&" },
  ];
  let output = input;
  for (const rule of rules) {
    output = output.replace(rule.re, rule.replace);
  }
  return output;
}

export async function runPgDumpSchemaOnly(
  connectionString: string,
  runQuery: (connectionString: string, query: string) => Promise<{ success: boolean; data?: { rows: any[] }; error?: string }>
) {
  const schemas = await getAllowedSchemasForDump(connectionString, runQuery);
  if (schemas.length === 0) {
    throw new Error("No accessible schemas found to export.");
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const conn = stripRexaDbParams(connectionString);
  const isSupabase = isLikelySupabaseConnection(connectionString);
  const excludedSchemas = isSupabase
    ? "information_schema|pg_*|_analytics|_realtime|_supavisor|auth|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault"
    : "information_schema|pg_*";

  const args = [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--quote-all-identifiers",
    `--exclude-schema=${excludedSchemas}`,
    ...schemas.map((schema) => `--schema=${schema}`),
    `--dbname=${conn}`,
  ];
  const env = { ...process.env } as NodeJS.ProcessEnv;
  const password = getPgPassword(connectionString);
  if (password) {
    env.PGPASSWORD = password;
  }

  let pgDumpBinary = "pg_dump";
  let pgDumpCandidates: string[] = [];
  try {
    const resolved = await resolvePgDumpBinary();
    pgDumpBinary = resolved.binary;
    pgDumpCandidates = resolved.candidates;
    const { stdout } = await execFileAsync(pgDumpBinary, args, {
      env,
      maxBuffer: 50 * 1024 * 1024,
    });
    const raw = stdout || "";
    return isSupabase ? applySupabaseDumpTransforms(raw, excludedSchemas) : raw;
  } catch (error: any) {
    const message = error?.stderr || error?.message || "pg_dump failed";
    const isMissing = error?.code === "ENOENT" || String(message).includes("ENOENT");
    const pathInfo = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `resourcesPath=${(process as { resourcesPath?: string }).resourcesPath ?? "n/a"}`,
      `REXADB_PG_DUMP_PATH=${process.env.REXADB_PG_DUMP_PATH || "n/a"}`,
      `PG_DUMP_PATH=${process.env.PG_DUMP_PATH || "n/a"}`,
      `resolved=${pgDumpBinary}`,
      `candidates=${pgDumpCandidates.length ? pgDumpCandidates.join(",") : "n/a"}`,
      `PATH=${process.env.PATH || "n/a"}`,
    ].join(" | ");

    if (isMissing) {
      throw new Error(
        `pg_dump not found (ENOENT). ${pathInfo}`
      );
    }
    throw new Error(`${message} | ${pathInfo}`);
  }
}

export async function resetAndApplySql(connectionString: string, fullSql: string) {
  if (!isPostgresConnection(connectionString)) {
    throw new Error("SQL import is supported only for PostgreSQL connections.");
  }

  const { Client } = (globalThis as any).__pg || (await import("pg")).default;

  const client = new Client({
    host: getPgHost(connectionString),
    port: getPgPort(connectionString),
    database: getPgDatabase(connectionString),
    user: getPgUsername(connectionString),
    password: getPgPassword(connectionString),
    connectionTimeoutMillis: 15000,
    ssl: getPgSslConfig(connectionString),
  });

  await client.connect();
  try {
    const isSupabase = isLikelySupabaseConnection(connectionString);
    const existingSchemas = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'public')
        AND schema_name NOT LIKE 'pg_%'
      ORDER BY schema_name;
    `);

    for (const row of existingSchemas.rows) {
      const schemaName = String(row.schema_name);
      if (isSupabase && isSupabaseExcludedSchema(schemaName)) {
        continue;
      }
      const schema = schemaName.replace(/"/g, "\"\"");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
    }

    await client.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
    await client.query(fullSql);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function exportDatabaseBundle(
  connectionString: string,
  format: "sql" | "json" | "csv",
  runQuery: (connectionString: string, query: string) => Promise<{ success: boolean; data?: { rows: any[] }; error?: string }>
) {
  if (!isPostgresConnection(connectionString)) {
    return { success: false, error: "Database bundle export is currently supported only for PostgreSQL connections." };
  }

  try {
    const snapshot = await getFullSqlSnapshot(connectionString, runQuery);
    if (!snapshot.success || !snapshot.fullSql) {
      return { success: false, error: snapshot.error || "Failed to export database" };
    }

    const generatedAt = new Date().toISOString();
    if (format === "sql") {
      return {
        success: true,
        data: {
          filename: `rexa-db-export-${Date.now()}.sql`,
          mimeType: "application/sql",
          content: snapshot.fullSql,
        }
      };
    }

    if (format === "json") {
      const content = JSON.stringify({
        format: "rexa-db-export-v1",
        generatedAt,
        schemaSql: snapshot.schemaSql,
        dataSql: snapshot.dataSql,
        fullSql: snapshot.fullSql,
      }, null, 2);

      return {
        success: true,
        data: {
          filename: `rexa-db-export-${Date.now()}.json`,
          mimeType: "application/json",
          content,
        }
      };
    }

    const fullSqlBase64 = Buffer.from(snapshot.fullSql, "utf-8").toString("base64");
    const csvLines = [
      "section,key,value",
      `meta,format,${encodeCsvCell("rexa-db-export-v1")}`,
      `meta,generated_at,${encodeCsvCell(generatedAt)}`,
      `payload,full_sql_base64,${encodeCsvCell(fullSqlBase64)}`,
    ];

    return {
      success: true,
      data: {
        filename: `rexa-db-export-${Date.now()}.csv`,
        mimeType: "text/csv",
        content: csvLines.join("\n"),
      }
    };
  } catch (error: any) {
    console.error("Failed to export database bundle:", error);
    return { success: false, error: error.message };
  }
}

export async function importDatabaseBundle(connectionString: string, format: "sql" | "json" | "csv", content: string) {
  if (!isPostgresConnection(connectionString)) {
    return { success: false, error: "Database bundle import is currently supported only for PostgreSQL connections." };
  }

  try {
    let fullSql = "";

    if (format === "sql") {
      fullSql = content;
    } else if (format === "json") {
      const parsed = JSON.parse(content);
      fullSql = parsed?.fullSql || `${parsed?.schemaSql || ""}\n\n${parsed?.dataSql || ""}`;
    } else {
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      for (const line of lines) {
        if (!line || line.startsWith("section,")) continue;
        const [section, key, ...rest] = parseCsvLine(line);
        if (section === "payload" && key === "full_sql_base64") {
          fullSql = Buffer.from(rest.join(","), "base64").toString("utf-8");
          break;
        }
      }
    }

    if (!fullSql.trim()) {
      return { success: false, error: "Import file does not contain a valid SQL payload." };
    }

    await resetAndApplySql(connectionString, fullSql);
    return { success: true };
  } catch (error: any) {
    console.error("Failed to import database bundle:", error);
    return { success: false, error: error.message };
  }
}
