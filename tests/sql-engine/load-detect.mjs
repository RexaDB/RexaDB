import { loadTsModule } from "../helpers/load-ts-module.mjs";

async function loadDetectModule() {
  return await loadTsModule({
    files: ["lib/db/sql-engine/detect.ts"],
    entryFile: "sql-engine/detect.js",
    outDir: "tests/.compiled/sql-engine",
    extraFiles: ["lib/db/connection-type.ts"],
  });
}
