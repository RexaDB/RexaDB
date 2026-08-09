import assert from "node:assert/strict";
import path from "node:path";
import { loadTsModule } from "../helpers/load-ts-module.mjs";

const cwd = process.cwd();

export async function loadSqlEngine() {
  await loadTsModule({
    sourceDir: "lib/db/sql-engine",
    entryFile: "sql-engine/index.js",
    outDir: "tests/.compiled/sql-engine-full",
    extraFiles: [
      "lib/db/connection-type.ts",
      "lib/db/sqlite-client.ts",
      "lib/db/mysql-client.ts",
      "lib/db/mysql-referenced-record.ts",
      "lib/db/pg-client.ts",
      "lib/db/postgres-compat/ast.ts",
      "lib/db/postgres-compat/casts.ts",
      "lib/db/postgres-compat/compile.ts",
      "lib/db/postgres-compat/ddl-alter-table.ts",
      "lib/db/postgres-compat/ddl-alter-column.ts",
      "lib/db/postgres-compat/ddl-compile.ts",
      "lib/db/postgres-compat/ddl-constraints.ts",
      "lib/db/postgres-compat/ddl-create-table.ts",
      "lib/db/postgres-compat/ddl-default.ts",
      "lib/db/postgres-compat/ddl-generic.ts",
      "lib/db/postgres-compat/ddl-shared.ts",
      "lib/db/postgres-compat/ilike.ts",
      "lib/db/postgres-compat/mysql-compile.ts",
      "lib/db/postgres-compat/mysql-identifiers.ts",
      "lib/db/postgres-compat/mysql-upsert.ts",
      "lib/db/postgres-compat/normalize.ts",
      "lib/db/postgres-compat/params.ts",
      "lib/db/postgres-compat/returning.ts",
      "lib/db/postgres-compat/statement-kind.ts",
      "lib/db/postgres-compat/types.ts",
      "lib/db/postgres-compat/validate.ts",
    ],
  });
  const outDir = path.join(cwd, "tests/.compiled/sql-engine-full");
  const sqlEngine = await import(path.join(outDir, "sql-engine/index.js"));
  const sqliteClient = await import(path.join(outDir, "sqlite-client.js"));
  return { sqlEngine, sqliteClient };
}

export async function verifyReferencedRecordAndMutate(
  sqlEngine: { executeSqlEngineQuery: (cs: string, q: string, p?: unknown[]) => Promise<any>; getSqlEngineReferencedRecord: (cs: string, s: string, t: string, k: Record<string, unknown>) => Promise<any>; updateSqlEngineRows: (cs: string, s: string, t: string, ops: any[]) => Promise<any>; deleteSqlEngineRows: (cs: string, s: string, t: string, c: string, v: any[]) => Promise<any> },
  url: string,
  schema: string,
  updateQuery: string,
  updateParams: unknown[],
) {
  const referenced = await sqlEngine.getSqlEngineReferencedRecord(url, schema, "users", { id: 1 });
  assert.equal(referenced.row?.id, 1);
  assert.equal(referenced.row?.name, "Ada");
  assert.ok(referenced.fields.length > 0);

  const updateResult = await sqlEngine.updateSqlEngineRows(url, schema, "users", [
    { where: { id: 1 }, set: { name: "Grace" } },
  ]);
  assert.deepEqual(updateResult, { success: true });

  const updated = await sqlEngine.executeSqlEngineQuery(url, updateQuery, updateParams);
  assert.equal(updated.rows[0].name, "Grace");

  const deleteResult = await sqlEngine.deleteSqlEngineRows(url, schema, "posts", "id", [10]);
  assert.equal(deleteResult.rowCount, 1);
}
