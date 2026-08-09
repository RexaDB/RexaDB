import { initBunSqliteDb } from "./db-utils";
import * as schema from "./schema";
import { drizzle } from "drizzle-orm/bun-sqlite";

const sqlite = initBunSqliteDb("sqlite.db", "app DB");
const db = drizzle(sqlite, { schema });

export { db };
