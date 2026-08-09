import { loadTsModule } from "../helpers/load-ts-module.mjs";
import path from "node:path";

async function loadMysqlAlterModule() {
  await loadTsModule({
    files: [
      "lib/db/mysql-alter/column-definition.ts",
      "lib/db/mysql-alter/default.ts",
      "lib/db/mysql-alter/not-null-query.ts",
      "lib/db/mysql-alter/quote.ts",
      "lib/db/postgres-compat/ast.ts",
      "lib/db/postgres-compat/normalize.ts",
    ],
    entryFile: "mysql-alter/column-definition.js",
    outDir: "tests/.compiled/mysql-alter",
  });
  const outDir = "/Users/virus/Downloads/Loom/RexaDB/tests/.compiled/mysql-alter/mysql-alter";
  const columnDefinition = await import(path.join(outDir, "column-definition.js"));
  const notNullQuery = await import(path.join(outDir, "not-null-query.js"));
  return { ...columnDefinition, ...notNullQuery };
}
