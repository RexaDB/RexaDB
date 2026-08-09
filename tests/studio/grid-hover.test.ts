import test from "node:test";
import assert from "node:assert/strict";
import { buildHoveredColumnCss } from "@/lib/studio/grid-hover";

test("buildHoveredColumnCss scopes hover styling to a single grid instance", () => {
  const css = buildHoveredColumnCss("grid-a", "id");

  assert.match(css, /\[data-grid-instance="grid-a"\]\s+\[data-column-name="id"\]/);
});

test("buildHoveredColumnCss escapes attribute values safely", () => {
  const css = buildHoveredColumnCss('grid"a', 'user"name');

  assert.match(css, /\[data-grid-instance="grid\\"a"\]/);
  assert.match(css, /\[data-column-name="user\\"name"\]/);
});
