import test from "node:test";
import assert from "node:assert/strict";
import { isUpdateDismissed, NIX_UPDATE_COMMAND } from "@/lib/app-update";

test("an update notice is hidden once the user dismisses that version", () => {
  assert.equal(isUpdateDismissed("1.3.26", "1.3.26"), true);
});

test("a newer release brings the notice back", () => {
  assert.equal(isUpdateDismissed("1.3.26", "1.3.27"), false);
});

test("nothing is dismissed before a version is known", () => {
  assert.equal(isUpdateDismissed(null, "1.3.26"), false);
  assert.equal(isUpdateDismissed("1.3.26", null), false);
  assert.equal(isUpdateDismissed(null, null), false);
});

test("the nix update command updates every input", () => {
  // Without an argument it works whatever the user named the input.
  assert.equal(NIX_UPDATE_COMMAND, "nix flake update");
});
