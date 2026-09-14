import test from "node:test";
import assert from "node:assert/strict";
import { getTabConfig, getViewMode, getTabIcon } from "../../lib/studio/tab-registry";

test("extensions tab is registered with viewMode + renderer", () => {
  const config = getTabConfig("extensions");
  assert.ok(config, "extensions tab config exists");
  assert.equal(config?.viewMode, "extensions");
  assert.equal(getViewMode("extensions"), "extensions");
  assert.equal(typeof config?.renderComponent, "function");
  assert.ok(getTabIcon("extensions"), "extensions tab has an icon");
});

test("extensions tab builds a stable singleton id", () => {
  const config = getTabConfig("extensions");
  assert.equal(config?.buildTabId({}), "extensions");
  const tab = config?.createTab("extensions", {});
  assert.equal(tab?.type, "extensions");
  assert.equal(tab?.name, "Extensions");
});

test("extension-view tab is registered and resolves view ids", () => {
  const config = getTabConfig("extension-view");
  assert.ok(config, "extension-view tab config exists");
  assert.equal(config?.buildTabId({ viewId: "demo.view" }), "extview-demo.view");
  const tab = config?.createTab("extview-demo.view", {
    viewId: "demo.view",
    title: "Demo",
    extensionId: "demo.ext",
  }) as { type?: string; name?: string; extensionViewId?: string; extensionId?: string };
  assert.equal(tab?.type, "extension-view");
  assert.equal(tab?.name, "Demo");
  assert.equal(tab?.extensionViewId, "demo.view");
  assert.equal(tab?.extensionId, "demo.ext");
  assert.equal(typeof config?.renderComponent, "function");
});

test("extension-panel tab carries its own tab html (never sidebar content)", () => {
  const config = getTabConfig("extension-panel");
  assert.ok(config, "extension-panel tab config exists");
  assert.equal(config?.buildTabId({ panelId: "demo.dashboard" }), "extpanel-demo.dashboard");
  const tab = config?.createTab("extpanel-demo.dashboard", {
    panelId: "demo.dashboard",
    title: "Demo Dashboard",
    extensionId: "demo.ext",
    html: "<h1>tab content</h1>",
  }) as {
    type?: string;
    name?: string;
    extensionPanelId?: string;
    extensionId?: string;
    extensionPanelHtml?: string;
  };
  assert.equal(tab?.type, "extension-panel");
  assert.equal(tab?.name, "Demo Dashboard");
  assert.equal(tab?.extensionPanelId, "demo.dashboard");
  assert.equal(tab?.extensionPanelHtml, "<h1>tab content</h1>");
  assert.equal(typeof config?.renderComponent, "function");
});
