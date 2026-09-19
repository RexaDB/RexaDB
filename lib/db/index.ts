import { initBunSqliteDb } from "./db-utils";
import * as schema from "./schema";
import { drizzle } from "drizzle-orm/bun-sqlite";
// Deep CJS import: the package's ESM shim re-exports via runtime
// createRequire('./cjs/index.js'), which breaks inside the compiled
// single-file sidecar (bun build --compile). The CJS build bundles fine.
import { better } from "better-drizzle/dist/index.cjs";

const sqlite = initBunSqliteDb("sqlite.db", "app DB");
const db = drizzle(sqlite, { schema });

/**
 * better-drizzle repository client over the same app DB.
 * Typed per-table delegates: `client.connections.findMany(...)`,
 * `client.queryHistory.paginate(...)`, `client Workflows.create(...)`, etc.
 * Raw Drizzle `db` is still exported for escape hatches
 * (PRAGMA/DDL, hand-written SQL, manual BEGIN/COMMIT transactions).
 */
const client = better(db, { schema });

export { db, client };
export type AppDbClient = typeof client;
