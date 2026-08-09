import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownBlocks } from "../../lib/ai/markdown-blocks";

test("parseMarkdownBlocks handles code, list, table, paragraph", () => {
  const source = [
    "Hello world.",
    "", 
    "- one",
    "- two",
    "",
    "| name | value |",
    "| --- | --- |",
    "| a | 1 |",
    "",
    "```sql",
    "select 1;",
    "```",
  ].join("\n");

  const blocks = parseMarkdownBlocks(source);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[0].text, "Hello world.");
  assert.equal(blocks[1].type, "list");
  assert.deepEqual(blocks[1].items, ["one", "two"]);
  assert.equal(blocks[2].type, "table");
  assert.deepEqual(blocks[2].headers, ["name", "value"]);
  assert.deepEqual(blocks[2].rows, [["a", "1"]]);
  assert.equal(blocks[3].type, "code");
  assert.equal(blocks[3].language, "sql");
  assert.equal(blocks[3].code, "select 1;");
});
