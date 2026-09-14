import test from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "../../lib/extensions/types";

const valid = {
  id: "acme.my-ext",
  name: "my-ext",
  version: "1.0.0",
  engines: { rexadb: "^1.0.0" },
  contributes: {
    commands: [{ command: "my-ext.hello", title: "Hello" }],
  },
};

test("validateManifest accepts a minimal manifest", () => {
  assert.equal(validateManifest(valid).ok, true);
});

test("validateManifest rejects bad id, version, engines", () => {
  const r = validateManifest({ ...valid, id: "bad", version: "x", engines: {} });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("id")));
  assert.ok(r.errors.some((e) => e.includes("version")));
  assert.ok(r.errors.some((e) => e.includes("engines.rexadb")));
});

test("validateManifest requires command + title", () => {
  const r = validateManifest({
    ...valid,
    contributes: { commands: [{ command: "", title: "" }] },
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});
