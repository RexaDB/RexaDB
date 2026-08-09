import { loadTsModule } from "../helpers/load-ts-module.mjs";

async function loadCompiler() {
  return await loadTsModule({
    sourceDir: "lib/db/postgres-compat",
    entryFile: "compile.js",
    outDir: "tests/.compiled/pgcompat",
  });
}
