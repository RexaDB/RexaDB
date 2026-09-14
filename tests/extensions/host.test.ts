import test from "node:test";
import assert from "node:assert/strict";
import { runInProcess, type HostCallbacks } from "../../lib/extensions/extension-host";

function makeCallbacks(): HostCallbacks & {
  registered: Array<{ extensionId: string; command: string; title?: string }>;
  messages: string[];
  statusBar: Array<{ extensionId: string; id: string; text: string }>;
  providers: string[];
  completions: Array<{ languageId: string; count: number }>;
  queries: string[];
} {
  const state = {
    registered: [] as Array<{ extensionId: string; command: string; title?: string }>,
    messages: [] as string[],
    statusBar: [] as Array<{ extensionId: string; id: string; text: string }>,
    providers: [] as string[],
    completions: [] as Array<{ languageId: string; count: number }>,
    queries: [] as string[],
  };
  const callbacks: HostCallbacks = {
    commands: {
      register: (extensionId, command, title) => {
        state.registered.push({ extensionId, command, title });
      },
      execute: async () => undefined as never,
      list: () => [],
    },
    window: {
      showMessage: async (_kind, message) => {
        state.messages.push(message);
      },
      showInputBox: async () => undefined,
      statusBarCreate: (extensionId, id, text) => {
        state.statusBar.push({ extensionId, id, text });
      },
      statusBarUpdate: () => {},
      webviewViewRegister: () => {},
      sidebarPageRegister: () => {},
      webviewPanelOpen: () => {},
    },
    tree: { registerProvider: (eid, viewId) => void state.providers.push(`${eid}:${viewId}`), setChildren: () => {} },
    workspace: { get: async () => ({}), set: async () => {} },
    languages: {
      completionsAdd: (languageId, items) => {
        state.completions.push({ languageId, count: items.length });
      },
      formatterAdd: () => {},
    },
    db: {
      getConnections: async () => [{ id: 1, name: "local", dbType: "postgres" }],
      getActiveConnection: async () => null,
      executeQuery: async () => ({ rows: [], fields: [] }),
      getSchema: async () => ({ database: "db", dbType: "postgres", schemas: ["public"], tables: [] }),
      readTable: async () => ({ rows: [], fields: [] }),
      getActiveQuery: async () => "SELECT 1",
      setActiveQuery: async (sql: string) => void state.queries.push(sql),
      openVisualizer: async () => {},
    },
    ai: { registerTool: () => {} },
    env: { clipboardWrite: async () => {} },
    rail: { create: () => {} },
    tabs: { open: () => {} },
  };
  return Object.assign(callbacks, state);
}

const CODE = `
async function activate(rexa) {
  await rexa.commands.registerCommand("demo.hello", "Say hello", "Demo");
  await rexa.window.showInformationMessage("hi");
  await rexa.window.createStatusBarItem("s1", "demo");
  await rexa.languages.registerCompletionItems("sql", [{ label: "DEMO_KW" }]);
  await rexa.window.registerTreeDataProvider("demo.view", {
    getChildren: async () => [{ id: "a", label: "A" }],
  });
}
`;

test("runInProcess activates extension and routes api calls", async () => {
  const cb = makeCallbacks();
  await runInProcess("demo.ext", CODE, cb);
  assert.ok(cb.registered.some((r) => r.command === "demo.hello"));
  assert.deepEqual(cb.messages, ["hi"]);
  assert.ok(cb.statusBar.some((s) => s.text === "demo"));
  assert.ok(cb.completions.some((c) => c.languageId === "sql" && c.count === 1));
  assert.ok(cb.providers.includes("demo.ext:demo.view"));
});

test("runInProcess throws when no activate export", async () => {
  const cb = makeCallbacks();
  await assert.rejects(() => runInProcess("demo.ext", "const x = 1;", cb), /no activate/);
});

const WORKER_STYLE_CODE = `
async function activate(rexa) {
  await rexa.commands.registerCommand("demo.ping", "Ping", "Demo");
  rexa.__registerHandler("command:demo.ping", async (name) => "pong:" + name);
  rexa.__registerHandler("tree:demo.view", async (parentId) => (
    parentId ? [] : [{ id: "root", label: "Root", collapsible: false }]
  ));
  await rexa.window.registerTreeDataProvider("demo.view", {
    getChildren: async () => [{ id: "root", label: "Root" }],
  });
}
`;

test("runInProcess supports worker-style __registerHandler", async () => {
  const cb = makeCallbacks();
  const { api } = await runInProcess("demo.ext", WORKER_STYLE_CODE, cb);
  const result = await api.commands.executeCommand("demo.ping", "x");
  assert.equal(result, "pong:x");
  assert.ok(cb.providers.includes("demo.ext:demo.view"));
});

test("write queries are blocked without the query:write capability", async () => {
  const cb = makeCallbacks();
  const { api } = await runInProcess("demo.ext", "async function activate() {}", {
    ...cb,
    resolveCapabilities: () => ["query:read"],
  });
  await assert.rejects(() => api.rexaDb.executeQuery("DELETE FROM users"), /query:write/);
  const ok = await api.rexaDb.executeQuery("SELECT 1");
  assert.deepEqual(ok, { rows: [], fields: [] });
});

test("write queries pass with the query:write capability", async () => {
  const cb = makeCallbacks();
  const { api } = await runInProcess("demo.ext", "async function activate() {}", {
    ...cb,
    resolveCapabilities: () => ["query:write"],
  });
  const ok = await api.rexaDb.executeQuery("DELETE FROM users");
  assert.deepEqual(ok, { rows: [], fields: [] });
});

test("rail and tab calls route to host callbacks", async () => {
  const cb = makeCallbacks();
  const railSeen: unknown[] = [];
  const tabsSeen: unknown[] = [];
  const { api } = await runInProcess("demo.ext", "async function activate() {}", {
    ...cb,
    rail: { create: (eid, item) => void railSeen.push([eid, item]) },
    tabs: { open: (eid, viewId, opts) => void tabsSeen.push([eid, viewId, opts]) },
  });
  await api.window.createRailItem("r1", "Rail One", { command: "demo.hello" });
  await api.window.openTab("demo.view", { title: "Demo" });
  assert.deepEqual(railSeen, [["demo.ext", { id: "r1", title: "Rail One", command: "demo.hello" }]]);
  assert.deepEqual(tabsSeen, [["demo.ext", "demo.view", { title: "Demo" }]]);
});

test("registerSidebarPage routes to the host callback", async () => {
  const cb = makeCallbacks();
  const pagesSeen: unknown[] = [];
  const { api } = await runInProcess("demo.ext", "async function activate() {}", {
    ...cb,
    window: {
      ...cb.window,
      sidebarPageRegister: (eid, containerId, html) => void pagesSeen.push([eid, containerId, html]),
    },
  });
  await api.window.registerSidebarPage("demo.group", "<h1>sidebar</h1>");
  assert.deepEqual(pagesSeen, [["demo.ext", "demo.group", "<h1>sidebar</h1>"]]);
});
