import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as pointer from "../../lib/neon-cli/pointer.ts";

const project = { id: "project", name: "Project" };
const branch = { id: "branch", name: "Branch" };
const savedConnection = (role = "owner") => pointer.buildNeonCliConnectionString({
  profile: "account-a", projectId: project.id, branchId: branch.id, database: "db", role,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ databases = async () => [{ name: "db" }], roles = ["owner", "reader"], existing = [] } = {}) {
  let slots = [];
  let cursor = 0;
  let cleanups = [];
  let currentKey;
  const saves = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); }
    },
  };
  const props = {
    accounts: [{ id: "a", profileName: "account-a" }, { id: "b", profileName: "account-b" }],
    activeAccountId: "a",
    existingConnectionStrings: existing,
    cliInstalled: true,
    onConnectDatabase: async (value) => { saves.push(value); },
  };
  const dependencies = {
    react,
    "react/jsx-runtime": { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    "@/lib/neon-cli/pointer": pointer,
    "@/lib/neon-cli/client": {
      listBranches: async () => [branch],
      listDatabases: databases,
      listRoles: async () => roles.map((name) => ({ name })),
    },
    "@/components/shared/provider-accounts/use-org-scoped-loader": {
      useOrgScopedLoader: () => ({ orgs: [], resources: [project] }),
    },
    "@/components/shared/provider-accounts": {
      ResourceRow: "ResourceRow",
      filterByName: (items) => items,
      buildAccountChips: () => [],
    },
    sonner: { toast: { info() {}, error() {} } },
  };
  const source = readFileSync(new URL("../../components/neon/neon-account-screen.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function("require", "exports", outputText)(
    (name) => dependencies[name] ?? new Proxy({}, { get: (_, key) => key }), exports,
  );
  function render() {
    const element = exports.NeonAccountsScreen(props);
    if (element.key !== currentKey) {
      cleanups.forEach((cleanup) => cleanup?.());
      slots = [];
      cleanups = [];
      currentKey = element.key;
    }
    cursor = 0;
    return element.type(element.props);
  }
  function nodes(type) {
    const matches = [];
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.type === type) matches.push(node);
      walk(node.props?.children);
    }
    walk(render());
    return matches;
  }
  async function openBranch() {
    nodes("ResourceRow")[0].props.onClick();
    await flush();
    nodes("Button").find((node) => Array.isArray(node.props.children) && node.props.children.includes("Connect")).props.onClick();
    await flush();
  }
  return { props, saves, nodes, render, openBranch };
}

test("connected database remains available for a different role; duplicate pair cannot submit", async () => {
  const ui = harness({ existing: [savedConnection()] });
  await ui.openBranch();
  const selects = ui.nodes("Select");
  assert.equal(selects[0].props.value, "db");
  assert.equal(selects[1].props.value, "reader");
  selects[1].props.onValueChange("owner");
  const duplicateButton = ui.nodes("Button").find((node) => node.props.children === "Connect");
  assert.equal(duplicateButton.props.disabled, true);
  duplicateButton.props.onClick();
  assert.equal(ui.saves.length, 0);
  ui.nodes("Select")[1].props.onValueChange("reader");
  ui.nodes("Button").find((node) => node.props.children === "Connect").props.onClick();
  await flush();
  assert.equal(ui.saves[0].connectionString, savedConnection("reader"));
  assert.equal(ui.saves[0].name, "Project (Branch) / db (reader)");
});

test("single database shortcut does not save an existing connection", async () => {
  const ui = harness({ roles: ["owner"], existing: [savedConnection()] });
  await ui.openBranch();
  assert.equal(ui.saves.length, 0);
  assert.equal(ui.nodes("Dialog")[0].props.open, false);
});

for (const roles of [["owner"], ["owner", "reader"]]) {
  test(`account switch discards pending results with ${roles.length} roles`, async () => {
    let resolveDatabases;
    const ui = harness({ roles, databases: () => new Promise((resolve) => { resolveDatabases = resolve; }) });
    await ui.openBranch();
    ui.props.activeAccountId = "b";
    ui.render();
    resolveDatabases([{ name: "db" }]);
    await flush();
    assert.equal(ui.saves.length, 0);
    assert.equal(ui.nodes("Dialog")[0].props.open, false);
  });
}
