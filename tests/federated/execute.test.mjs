import test from "node:test";
import assert from "node:assert/strict";
import { loadFederatedCore } from "./load-federated.mjs";

const SALES_USERS_ROWS = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Grace" },
];

const SALES_USERS_COLUMNS = [
  { name: "id", dataType: "integer" },
  { name: "name", dataType: "text" },
];

function salesUsersLoader(alias, table) {
  if (alias === "sales" && table === "users") {
    return { columns: SALES_USERS_COLUMNS, rows: SALES_USERS_ROWS };
  }
  throw new Error(`Unexpected table load for ${alias}.${table}`);
}

function createUnionAllMocks(firstTableName, firstTableRows) {
  const loader = async (alias, table) => {
    if (alias === "sales" && table === firstTableName) {
      return {
        columns: [
          { name: "id", dataType: "integer" },
          { name: "name", dataType: "text" },
        ],
        rows: firstTableRows,
      };
    }
    if (alias === "billing" && table === "connections") {
      return {
        columns: [
          { name: "id", dataType: "integer" },
          { name: "email", dataType: "text" },
        ],
        rows: [{ id: 2, email: "ops@example.com" }],
      };
    }
    throw new Error(`Unexpected table load for ${alias}.${table}`);
  };
  const resolver = async (table) => {
    if (table === firstTableName) return "sales";
    if (table === "connections") return "billing";
    throw new Error(`Unexpected alias lookup for ${table}`);
  };
  return { loader, resolver };
}

test("executes federated joins across mapped aliases", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  const result = await executeFederatedQueryWithLoader(
    "select u.name, o.total from sales.users u join billing.orders o on u.id = o.user_id where u.name ilike $1 order by o.total desc",
    ["a%"],

    { sales: "public", billing: "main" },
    async (alias, table) => {
      if (alias === "sales" && table === "users") {
        return {
          columns: [
            { name: "id", dataType: "integer" },
            { name: "name", dataType: "text" },
          ],
          rows: [
            { id: 1, name: "Ada" },
            { id: 2, name: "Grace" },
          ],
        };
      }
      if (alias === "billing" && table === "orders") {
        return {
          columns: [
            { name: "id", dataType: "integer" },
            { name: "user_id", dataType: "integer" },
            { name: "total", dataType: "integer" },
          ],
          rows: [
            { id: 10, user_id: 1, total: 80 },
            { id: 11, user_id: 1, total: 120 },
            { id: 12, user_id: 2, total: 40 },
          ],
        };
      }
      throw new Error(`Unexpected table load for ${alias}.${table}`);
    },
  );
  assert.deepEqual(result.rows, [
    { name: "Ada", total: 120 },
    { name: "Ada", total: 80 },
  ]);
  assert.equal(result.rowCount, 2);
});

test("rejects non-select federated queries", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  await assert.rejects(
    () =>
      executeFederatedQueryWithLoader(
        "update sales.users set name = $1 where id = $2",
        ["Ada", 1],
        { sales: "public" },
        async () => ({ columns: [], rows: [] }),
      ),
    /SELECT, WITH, and set-operation statements only/,
  );
});

test("executes aggregate count queries against federated sources", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  const result = await executeFederatedQueryWithLoader(
    "select count(*) as count from sales.users u",

    [],
    { sales: "public" },
    salesUsersLoader,
  );
  assert.deepEqual(result.rows, [{ count: 2 }]);
});

test("executes federated table preview queries with limit and offset", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  const result = await executeFederatedQueryWithLoader(
    'SELECT * FROM "THIS_MUST_NOT_BE_22"."accounts" LIMIT 100 OFFSET 0;',
    [],
    { THIS_MUST_NOT_BE_22: "public" },
    salesUsersLoader,
  );
  assert.deepEqual(result.rows, [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ]);
});

test("resolves unqualified federated table names when they are unique", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  const result = await executeFederatedQueryWithLoader(
    "SELECT ALL FROM accounts",
    [],
    { sales: "public", billing: "main" },
    async (alias, table) => {
      if (alias === "sales" && table === "accounts") {
        return {
          columns: [{ name: "id", dataType: "integer" }],
          rows: [{ id: 1 }],
        };
      }
      throw new Error(`Unexpected table load for ${alias}.${table}`);
    },
    async (table) => {
      if (table === "accounts") return "sales";
      throw new Error(`Unexpected alias lookup for ${table}`);
    },
  );
  assert.deepEqual(result.rows, [{ id: 1 }]);
});

test("executes union all across federated sources", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  const { loader, resolver } = createUnionAllMocks("accounts", [{ id: 1, name: "Ada" }]);
  const result = await executeFederatedQueryWithLoader(
    "SELECT * FROM accounts UNION ALL SELECT * FROM connections",
    [],
    { sales: "public", billing: "main" },
    loader,
    resolver,
  );
  assert.deepEqual(result.rows, [
    { id: 1, name: "Ada", email: null },
    { id: 2, name: null, email: "ops@example.com" },
  ]);
});

test("executes multiline union all with a stray semicolon before the set op", async () => {
  const { executeFederatedQueryWithLoader } = await loadFederatedCore();
  const { loader, resolver } = createUnionAllMocks("plans", [{ id: 1, name: "Pro" }]);
  const result = await executeFederatedQueryWithLoader(
    "SELECT * FROM plans;\nUNION ALL\nSELECT * FROM connections;",
    [],
    { sales: "public", billing: "main" },
    loader,
    resolver,
  );
  assert.deepEqual(result.rows, [
    { id: 1, name: "Pro", email: null },
    { id: 2, name: null, email: "ops@example.com" },
  ]);
});
