import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStylePack,
  clearStylePack,
  getActiveStylePack,
  applyShell,
  clearShell,
  getActiveShell,
  planAppearanceRestore,
  scopeCss,
} from "../../lib/extensions/ui-style-packs";
import {
  registerUiComponent,
  unregisterUiComponent,
  peekUiComponent,
  resolveUiComponent,
  listRegisteredUiComponents,
} from "../../lib/extensions/ui-registry";
import { UI_SLOTS, isKnownUiSlot } from "../../lib/extensions/ui-slots";
import { validateManifest } from "../../lib/extensions/types";

test("UI_SLOTS includes shell and button", () => {
  assert.ok(UI_SLOTS.includes("shell"));
  assert.ok(UI_SLOTS.includes("button"));
  assert.equal(isKnownUiSlot("button"), true);
  assert.equal(isKnownUiSlot("not-a-slot"), false);
});

test("validateManifest accepts contributes.ui style packs and shells", () => {
  const r = validateManifest({
    id: "acme.look",
    name: "look",
    version: "1.0.0",
    engines: { rexadb: "^1.0.0" },
    contributes: {
      ui: {
        stylePacks: [{ id: "pill", label: "Pill", css: "[data-slot=button]{border-radius:9999px}" }],
        shells: [{ id: "compact", label: "Compact", className: "rexadb-shell-x", stylePackId: "pill" }],
      },
    },
  });
  assert.equal(r.ok, true);
});

test("ui registry registers and resolves components", () => {
  function FakeButton() {
    return null;
  }
  function Fallback() {
    return null;
  }
  const dispose = registerUiComponent("button", FakeButton);
  assert.equal(peekUiComponent("button"), FakeButton);
  assert.equal(resolveUiComponent("button", Fallback), FakeButton);
  assert.ok(listRegisteredUiComponents().includes("button"));
  dispose();
  assert.equal(peekUiComponent("button"), undefined);
  assert.equal(resolveUiComponent("button", Fallback), Fallback);
  unregisterUiComponent("button");
});

// DOM-backed apply/clear only when document exists (browser / happy-dom).
test("scopeCss prefixes selectors for pack attribute", () => {
  const packId = "acme.look:pill";
  const attr = `html[data-rexadb-ui-pack="${packId}"]`;
  const out = scopeCss(
    packId,
    '[data-slot="button"], [data-slot="input"] { border-radius: 9999px !important; }\n.rexadb-shell-x [data-slot="shell"] { --gap: 2px; }',
  );
  assert.ok(out.includes(`${attr} [data-slot="button"]`));
  assert.ok(out.includes(`${attr} [data-slot="input"]`));
  assert.ok(out.includes(`${attr}.rexadb-shell-x [data-slot="shell"]`));
});

test("planAppearanceRestore: explicit pack wins over shell-linked pack", () => {
  const packs = [
    { extensionId: "acme.look", id: "pill" },
    { extensionId: "acme.look", id: "flat" },
  ];
  const shells = [{ extensionId: "acme.look", id: "compact", stylePackId: "flat" }];
  const plan = planAppearanceRestore({
    savedPack: { extensionId: "acme.look", packId: "pill" },
    savedShell: { extensionId: "acme.look", shellId: "compact" },
    packs,
    shells,
  });
  assert.deepEqual(plan.shellToApply, { extensionId: "acme.look", shellId: "compact" });
  // The user's pack (not the shell's linked "flat") must end up applied,
  // and the picker must reflect it.
  assert.deepEqual(plan.packToApply, { extensionId: "acme.look", packId: "pill" });
  assert.equal(plan.packAppliedByShell, false);
  assert.equal(plan.clearShell, false);
  assert.equal(plan.clearPack, false);
});

test("planAppearanceRestore: shell-linked pack applies when no pack saved", () => {
  const plan = planAppearanceRestore({
    savedPack: null,
    savedShell: { extensionId: "acme.look", shellId: "compact" },
    packs: [{ extensionId: "acme.look", id: "flat" }],
    shells: [{ extensionId: "acme.look", id: "compact", stylePackId: "flat" }],
  });
  assert.deepEqual(plan.packToApply, { extensionId: "acme.look", packId: "flat" });
  assert.equal(plan.packAppliedByShell, true);
});

test("planAppearanceRestore: missing extensions clear without touching others", () => {
  const gone = planAppearanceRestore({
    savedPack: { extensionId: "gone.ext", packId: "pill" },
    savedShell: { extensionId: "gone.ext", shellId: "compact" },
    packs: [],
    shells: [],
  });
  assert.equal(gone.shellToApply, null);
  assert.equal(gone.clearShell, true);
  assert.equal(gone.packToApply, null);
  assert.equal(gone.clearPack, true);

  const missingPackKeepsShellLink = planAppearanceRestore({
    savedPack: { extensionId: "gone.ext", packId: "pill" },
    savedShell: { extensionId: "acme.look", shellId: "compact" },
    packs: [{ extensionId: "acme.look", id: "flat" }],
    shells: [{ extensionId: "acme.look", id: "compact", stylePackId: "flat" }],
  });
  // Shell's linked pack stays applied and picker aligns to it.
  assert.deepEqual(missingPackKeepsShellLink.packToApply, {
    extensionId: "acme.look",
    packId: "flat",
  });
  assert.equal(missingPackKeepsShellLink.clearPack, false);
});

test("style pack apply/clear is a no-op without document", () => {
  if (typeof document !== "undefined") {
    applyStylePack(
      {
        id: "pill",
        label: "Pill",
        cssVariables: { "button-radius": "9999px" },
        css: "[data-slot=\"button\"] { border-radius: 9999px !important; }",
      },
      "acme.look",
    );
    assert.equal(document.documentElement.dataset.rexadbUiPack, "acme.look:pill");
    assert.deepEqual(getActiveStylePack(), { extensionId: "acme.look", packId: "pill" });
    clearStylePack();
    assert.equal(document.documentElement.dataset.rexadbUiPack, undefined);
    assert.equal(getActiveStylePack(), null);
  } else {
    // Node: calls must not throw.
    applyStylePack({ id: "pill", label: "Pill", css: "x{}" }, "acme.look");
    clearStylePack();
    applyShell({ id: "c", label: "C", className: "cls" }, "acme.look");
    clearShell();
    assert.equal(getActiveStylePack(), null);
    assert.equal(getActiveShell(), null);
  }
});
