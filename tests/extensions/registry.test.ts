import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerSource } from "../../lib/extensions/extension-host";
import { parseExtensionBundle } from "../../lib/extensions/extension-registry";

test("buildWorkerSource embeds shim + extension code", () => {
  const src = buildWorkerSource("async function activate(rexa) {}");
  assert.ok(src.includes("__extensionActivate"));
  assert.ok(src.includes("async function activate"));
  assert.ok(src.includes("postMessage"));
});

test("parseExtensionBundle requires manifest", () => {
  assert.throws(() => parseExtensionBundle(JSON.stringify({})), /bundle must contain/);
  const bundle = parseExtensionBundle(
    JSON.stringify({
      manifest: { id: "a.b", name: "b", version: "1.0.0", engines: { rexadb: "^1" } },
      code: "async function activate() {}",
    }),
  );
  assert.equal(bundle.manifest.id, "a.b");
});

test("parseExtensionBundle accepts a raw manifest (static-only install)", () => {
  const bundle = parseExtensionBundle(
    JSON.stringify({ id: "a.b", name: "b", version: "1.0.0", engines: { rexadb: "^1" } }),
  );
  assert.equal(bundle.manifest.id, "a.b");
  assert.equal(bundle.code, undefined);
});
