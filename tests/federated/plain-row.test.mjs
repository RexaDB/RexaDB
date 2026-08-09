import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "../helpers/load-ts-module.mjs";

test("converts federated result rows to plain objects", async () => {
  const mod = await loadTsModule({
    files: ["lib/db/federated/plain-row.ts"],
    entryFile: "plain-row.js",
    outDir: "tests/.compiled/federated-plain-row",
  });
  class RowLike {
    constructor() {
      this.count = 200000;
    }
  }
  const rows = mod.toPlainFederatedRows([new RowLike()]);
  assert.deepEqual(rows, [{ count: 200000 }]);
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
});
