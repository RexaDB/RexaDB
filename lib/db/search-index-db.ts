import { initBunSqliteDb } from "./db-utils";
import { Database } from "bun:sqlite";

const sqlite = initBunSqliteDb("search-index.db", "search index DB");

export function getSearchIndexDb(): Database {
  return sqlite;
}
