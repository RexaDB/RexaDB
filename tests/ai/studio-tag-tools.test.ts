import assert from "node:assert/strict";
import { test } from "node:test";
import { createStudioTagTools } from "@/lib/ai/studio-tag-tools";

test("studio tag tools are available only for a saved connection", () => {
  const emitStep = () => {};
  assert.deepEqual(createStudioTagTools({ connectionId: null, emitStep }), []);
  assert.deepEqual(createStudioTagTools({ emitStep }), []);

  const tools = createStudioTagTools({ connectionId: 7, emitStep });
  assert.deepEqual(tools.map(({ name }) => name), [
    "create_studio_tags",
    "set_tags_for_tables",
    "list_studio_tags",
    "create_studio_tag",
    "update_studio_tag",
    "delete_studio_tag",
    "set_table_tags",
  ]);
});
