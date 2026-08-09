import test from "node:test";
import assert from "node:assert/strict";
import { loadFederatedCore } from "./load-federated.mjs";

test("builds and parses federated connection strings", async () => {
  const { buildFederatedConnectionString, parseFederatedConnectionString, isFederatedConnectionString } = await loadFederatedCore();
  const connectionString = buildFederatedConnectionString({
    version: 1,
    sources: [
      { alias: "sales", connectionId: 1, namespace: "public" },
      { alias: "billing", connectionId: 2, namespace: "main" },
    ],
  });
  assert.equal(isFederatedConnectionString(connectionString), true);
  assert.deepEqual(parseFederatedConnectionString(connectionString), {
    version: 1,
    sources: [
      { alias: "sales", connectionId: 1, namespace: "public" },
      { alias: "billing", connectionId: 2, namespace: "main" },
    ],
  });
});

test("rejects duplicate aliases in federated configs", async () => {
  const { buildFederatedConnectionString } = await loadFederatedCore();
  assert.throws(
    () => buildFederatedConnectionString({
      version: 1,
      sources: [
        { alias: "sales", connectionId: 1 },
        { alias: "sales", connectionId: 2 },
      ],
    }),
    /Duplicate federated alias/
  );
});
