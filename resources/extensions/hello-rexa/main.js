/**
 * Hello Rexa — example RexaDB extension (Worker sandbox, no imports).
 * Declares `activate(rexa)`; the host injects `rexa` (VS Code-like API).
 * Install via Extensions manager: paste `bundle.json`, or copy this file's
 * contents as `code` with `manifest.json` as `manifest`.
 */
async function activate(rexa) {
  // 1. Commands (appear in Cmd+K under "Hello Rexa").
  await rexa.commands.registerCommand("hello-rexa.say-hello", "Hello Rexa: Say Hello", "Hello Rexa");
  await rexa.commands.registerCommand("hello-rexa.insert-select-star", "Hello Rexa: Insert SELECT *", "Hello Rexa");
  await rexa.commands.registerCommand("hello-rexa.open-dashboard", "Hello Rexa: Open Dashboard Panel", "Hello Rexa");
  await rexa.commands.registerCommand("hello-rexa.show-schema", "Hello Rexa: Show Schema Summary", "Hello Rexa");

  // The Worker shim routes host->worker handler calls by name:
  // `command:<id>` for commands, `tree:<viewId>` for tree views.
  rexa.__registerHandler("command:hello-rexa.say-hello", async () => {
    await rexa.window.showInformationMessage("Hello from Hello Rexa!");
    return "greeted";
  });
  rexa.__registerHandler("command:hello-rexa.insert-select-star", async () => {
    const current = await rexa.rexaDb.getActiveQuery();
    await rexa.rexaDb.setActiveQuery(`${current}SELECT * `.trimStart());
    return "inserted";
  });
  rexa.__registerHandler("command:hello-rexa.open-dashboard", async () => {
    await rexa.window.openWebviewPanel(
      "hello-rexa.dashboard",
      "<html><body style='font-family:sans-serif;padding:16px'><h2>Hello Dashboard</h2><p>Opened at runtime.</p></body></html>",
    );
    return "opened";
  });
  rexa.__registerHandler("command:hello-rexa.show-schema", async () => {
    const schema = await rexa.rexaDb.getSchema();
    await rexa.window.showInformationMessage(
      `${schema.database || "active database"} (${schema.dbType}): ${schema.tables.length} table(s) across ${schema.schemas.length} schema(s).`
    );
    return schema;
  });

  // 2. Sidebar tree view.
  rexa.__registerHandler("tree:hello-rexa.connections", async (parentId) => {
    if (!parentId) {
      const connections = await rexa.rexaDb.getConnections();
      return connections.map((c) => ({
        id: `conn-${c.id}`,
        label: c.name,
        description: c.dbType,
        collapsible: true,
      }));
    }
    return [{ id: `${parentId}-info`, label: "Connection details live in RexaDB", collapsible: false }];
  });
  await rexa.window.registerTreeDataProvider("hello-rexa.connections");

  // 3. Status bar (rail icon comes from the viewsContainer `icon` — one
  // activity-rail entry opening this container's sidebar; no runtime
  // createRailItem here so we never produce a duplicate second icon).
  await rexa.window.createStatusBarItem("hello", "$(smiley) Hello Rexa", {
    tooltip: "Hello Rexa status item",
    command: "hello-rexa.say-hello",
    alignment: "right",
    priority: 100,
  });

  // 4. Open the webview as an editor tab on demand via command.
  rexa.__registerHandler("command:hello-rexa.open-tab", async () => {
    await rexa.window.openTab("hello-rexa.welcome", { title: "Hello Rexa" });
    return "tab-opened";
  });
  await rexa.commands.registerCommand("hello-rexa.open-tab", "Hello Rexa: Open Webview Tab", "Hello Rexa");

  // 4. Languages (SQL keyword completion).
  await rexa.languages.registerCompletionItems("sql", [
    { label: "HELLO_REXA", detail: "Hello Rexa keyword", insertText: "HELLO_REXA" },
  ]);

  // 5. AI tool.
  await rexa.ai.registerTool({
    id: "hello-rexa.explain-plan",
    label: "Explain plan",
    description: "Explains the active query plan.",
  });
}
