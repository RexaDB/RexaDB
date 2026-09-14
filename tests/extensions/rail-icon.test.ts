import test from "node:test";
import assert from "node:assert/strict";
import { resolveExtensionIconKind, visibleContainerRailEntries } from "../../lib/extensions/rail-icon";

test("resolveExtensionIconKind classifies icon strings", () => {
  assert.equal(resolveExtensionIconKind(undefined), "fallback");
  assert.equal(resolveExtensionIconKind(""), "fallback");
  assert.equal(resolveExtensionIconKind("<svg viewBox='0 0 16 16'></svg>"), "svg");
  assert.equal(resolveExtensionIconKind("  <svg></svg>"), "svg");
  assert.equal(resolveExtensionIconKind("🧪"), "text");
  assert.equal(resolveExtensionIconKind("DB"), "text");
  assert.equal(resolveExtensionIconKind("some-long-icon-name"), "fallback");
});

test("explicit rail items suppress only their own extension's auto container entries", () => {
  const containers = [
    { extensionId: "a.ext", containerId: "a.group" },
    { extensionId: "b.ext", containerId: "b.group" },
  ];
  // No explicit items → both containers visible.
  assert.deepEqual(
    visibleContainerRailEntries(containers, []).map((c) => c.containerId),
    ["a.group", "b.group"],
  );
  // Auto container items (id `container:…`) never suppress.
  assert.deepEqual(
    visibleContainerRailEntries(containers, [
      { extensionId: "a.ext", id: "container:a.group" },
    ]).map((c) => c.containerId),
    ["a.group", "b.group"],
  );
  // Explicit item from a.ext hides only a.ext's container.
  assert.deepEqual(
    visibleContainerRailEntries(containers, [{ extensionId: "a.ext", id: "hello" }]).map(
      (c) => c.containerId,
    ),
    ["b.group"],
  );
});
