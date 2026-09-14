import test from "node:test";
import assert from "node:assert/strict";
import { parseExtensionsSidebarView, extensionsSidebarViewFor } from "../../lib/extensions/sidebar-view";

test("parseExtensionsSidebarView handles plain + qualified views", () => {
  assert.deepEqual(parseExtensionsSidebarView(null), { active: false });
  assert.deepEqual(parseExtensionsSidebarView("tables"), { active: false });
  assert.deepEqual(parseExtensionsSidebarView("extensions"), { active: true });
  assert.deepEqual(parseExtensionsSidebarView("extensions:demo.group"), {
    active: true,
    containerId: "demo.group",
  });
  assert.deepEqual(parseExtensionsSidebarView("extensions:"), { active: false });
});

test("extensionsSidebarViewFor builds rail targets", () => {
  assert.equal(extensionsSidebarViewFor(), "extensions");
  assert.equal(extensionsSidebarViewFor("demo.group"), "extensions:demo.group");
});
