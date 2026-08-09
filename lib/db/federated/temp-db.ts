import { quoteFederatedIdent } from "./quote";

type FederatedExecuteArgs = { sql: string; args?: unknown[] };
type FederatedExecuteResult = { rows: unknown[]; rowsAffected?: number };
type FederatedTempClient = {
  execute: (input: FederatedExecuteArgs) => Promise<FederatedExecuteResult>;
  close?: () => void | Promise<void>;
};

async function createBunSqliteClient(): Promise<FederatedTempClient> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");

  return {
    execute: async ({ sql, args }) => {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = args && args.length > 0 ? stmt.all(...args) : stmt.all();
        return { rows, rowsAffected: rows.length };
      }
      const info = args && args.length > 0 ? stmt.run(...args) : stmt.run();
      return { rows: [], rowsAffected: Number(info.changes || 0) };
    },
    close: () => {
      db.close();
    },
  };
}

async function createBetterSqliteClient(): Promise<FederatedTempClient> {
  const mod = await import("better-sqlite3");
  const BetterSqlite3 = ((mod as unknown as { default?: unknown }).default ?? mod) as unknown as typeof import("better-sqlite3");
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");

  return {
    execute: async ({ sql, args }) => {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = args && args.length > 0 ? stmt.all(...args) : stmt.all();
        return { rows, rowsAffected: rows.length };
      }
      const info = args && args.length > 0 ? stmt.run(...args) : stmt.run();
      return { rows: [], rowsAffected: Number(info.changes || 0) };
    },
    close: () => {
      db.close();
    },
  };
}

async function createLibsqlClient(): Promise<FederatedTempClient> {
  const { createClient } = await import("@libsql/client/node");
  const client = createClient({ url: "file::memory:" });
  return {
    execute: async (input) => client.execute(input as any) as Promise<FederatedExecuteResult>,
    close: async () => {
      try {
        await client.close?.();
      } catch {}
    },
  };
}

async function createFederatedTempClient(): Promise<FederatedTempClient> {
  try {
    return await createBunSqliteClient();
  } catch {
    // bun:sqlite unavailable, fall through
  }
  try {
    return await createBetterSqliteClient();
  } catch (error) {
    console.warn("Federated temp DB fallback to libsql client:", error);
    return await createLibsqlClient();
  }
}

export async function withFederatedTempDb<T>(run: (client: FederatedTempClient) => Promise<T>) {
  const client = await createFederatedTempClient();
  try {
    return await run(client);
  } finally {
    await client.close?.();
  }
}

export async function createFederatedTempTable(client: FederatedTempClient, tableName: string, columns: Array<{ name: string; type: string }>) {
  const defs = columns.map((column) => `${quoteFederatedIdent(column.name)} ${column.type}`).join(", ");
  await client.execute({ sql: `CREATE TABLE ${quoteFederatedIdent(tableName)} (${defs})` });
}

export async function insertFederatedTempRow(client: FederatedTempClient, tableName: string, row: Record<string, unknown>) {
  const names = Object.keys(row);
  const placeholders = names.map(() => "?").join(", ");
  const sql = `INSERT INTO ${quoteFederatedIdent(tableName)} (${names.map(quoteFederatedIdent).join(", ")}) VALUES (${placeholders})`;
  await client.execute({ sql, args: names.map((name) => row[name] as unknown) });
}
