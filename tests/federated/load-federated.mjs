import path from "node:path";
import { loadTsModule } from "../helpers/load-ts-module.mjs";

const cwd = process.cwd();

async function loadFederatedCore() {
  await loadTsModule({
    files: [
      "lib/db/federated/connection-string.ts",
      "lib/db/federated/collect-refs.ts",
      "lib/db/federated/compact-query.ts",
      "lib/db/federated/execute-with-loader.ts",
      "lib/db/federated/normalize-value.ts",
      "lib/db/federated/normalize-rewritten-query.ts",
      "lib/db/federated/plain-row.ts",
      "lib/db/federated/result-fields.ts",
      "lib/db/federated/rewrite-query.ts",
      "lib/db/federated/rewrite-table.ts",
      "lib/db/federated/set-ops.ts",
      "lib/db/federated/sqlite-affinity.ts",
      "lib/db/federated/temp-db.ts",
      "lib/db/federated/temp-table-name.ts",
      "lib/db/federated/types.ts",
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
    entryFile: "federated/connection-string.js",
    outDir: "tests/.compiled/federated",
  });
  const outDir = path.join(cwd, "tests/.compiled/federated/federated");
  const connectionString = await import(path.join(outDir, "connection-string.js"));
  const executeWithLoader = await import(path.join(outDir, "execute-with-loader.js"));
  return { ...connectionString, ...executeWithLoader };
}
