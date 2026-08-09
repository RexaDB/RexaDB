import test from "node:test";
import assert from "node:assert/strict";
import { cn } from "../../lib/utils";

test("cn merges classnames and tailwind conflicts", () => {
  assert.equal(cn("p-2", "text-sm"), "p-2 text-sm");
  assert.equal(cn("p-2", "p-4"), "p-4");
  assert.equal(cn("text-sm", false && "hidden", undefined, "text-lg"), "text-lg");
});
