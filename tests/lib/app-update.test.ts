import test from "node:test";
import assert from "node:assert/strict";
import {
  isUpdateDismissed,
  NIX_UPDATE_COMMAND,
  NIX_UPDATE_OPTIONS,
} from "@/lib/app-update";

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

test("the nix instructions cover the ways rexadb can be installed", () => {
  const labels = NIX_UPDATE_OPTIONS.map((option) => option.label);
  assert.equal(labels.length, 3);
  assert.match(labels.join(" "), /unpinned input/);
  assert.match(labels.join(" "), /pinned release tag/);
  assert.match(labels.join(" "), /Profile install/);

  // A configuration flake moves its input, a profile install does not.
  const flake = NIX_UPDATE_OPTIONS.find((option) =>
    option.label.includes("unpinned"),
  );
  assert.equal(flake?.command, "nix flake update");
  const profile = NIX_UPDATE_OPTIONS.find((option) =>
    option.label.includes("Profile"),
  );
  assert.equal(profile?.command, "nix profile upgrade");

  // A flake that pins a release tag has no command: the tag is edited.
  const pinned = NIX_UPDATE_OPTIONS.find((option) =>
    option.label.includes("pinned release tag"),
  );
  assert.equal(pinned?.command, null);
  assert.match(pinned?.hint ?? "", /tag/);
});
