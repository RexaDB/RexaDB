import fs from "fs";
import path from "path";
import os from "os";
import { Database } from "bun:sqlite";

export function resolveDbPath(dbName: string) {
  const envDir = process.env.REXADB_USER_DATA_DIR;
  if (envDir) {
    fs.mkdirSync(envDir, { recursive: true });
    return path.join(envDir, dbName);
  }

  const home = os.homedir();
  if (home) {
    const appDir = path.join(home, ".rexadb");
    fs.mkdirSync(appDir, { recursive: true });
    return path.join(appDir, dbName);
  }

  return path.resolve(process.cwd(), dbName);
}

export function initBunSqliteDb(dbName: string, label: string): Database {
  const resolved = resolveDbPath(dbName);
  const dir = path.dirname(resolved);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new Error(`Cannot create ${label} directory "${dir}": ${e instanceof Error ? e.message : e}`);
  }
  let sqlite: Database;
  try {
    sqlite = new Database(resolved, { create: true });
  } catch (e) {
    throw new Error(`Cannot open ${label} at "${resolved}": ${e instanceof Error ? e.message : e}`);
  }
  try {
    sqlite.run("PRAGMA journal_mode=WAL");
    sqlite.run("PRAGMA synchronous=NORMAL");
  } catch {}
  return sqlite;
}
