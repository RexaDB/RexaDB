import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  buildRedisKeyTree,
  EMPTY_SEGMENT_LABEL,
  type RedisKeyTreeNode,
} from "../../../lib/studio/redis-key-tree";

function find(nodes: RedisKeyTreeNode[], fullKey: string): RedisKeyTreeNode | undefined {
  for (const node of nodes) {
    if (node.fullKey === fullKey) return node;
    const hit = find(node.children, fullKey);
    if (hit) return hit;
  }
  return undefined;
}

test("hybrid key is both a value and a parent", () => {
  const tree = buildRedisKeyTree(["org:id", "org:id:status"]);
  const id = find(tree, "org:id");
  assert.ok(id, "org:id node exists");
  assert.equal(id.hasValue, true);
  assert.equal(id.children.length, 1);
  assert.equal(id.children[0].fullKey, "org:id:status");
  assert.equal(id.children[0].hasValue, true);
});

test("empty segments are preserved, never renamed or merged", () => {
  const tree = buildRedisKeyTree(["a::b", "a:b"]);
  const aColA = find(tree, "a::b");
  const aB = find(tree, "a:b");
  assert.ok(aColA, "a::b node exists");
  assert.ok(aB, "a:b node exists");
  assert.notEqual(aColA, aB, "a::b and a:b stay distinct nodes");
  assert.equal(aColA.fullKey, "a::b");
  assert.equal(aColA.hasValue, true);
  assert.equal(aB.fullKey, "a:b");
  assert.equal(aB.hasValue, true);
});

test("empty segment gets a visible placeholder label", () => {
  const tree = buildRedisKeyTree(["a::b"]);
  const empty = find(tree, "a:");
  assert.ok(empty, "empty segment node exists");
  assert.equal(empty.segment, "");
  assert.ok(EMPTY_SEGMENT_LABEL.length > 0, "placeholder is non-empty");
});

test("colon-only key survives with the exact original name", () => {
  const tree = buildRedisKeyTree([":"]);
  const colon = find(tree, ":");
  assert.ok(colon, "key ':' terminates somewhere");
  assert.equal(colon.fullKey, ":");
  assert.equal(colon.hasValue, true);
});

test("leading-colon key rejoins to the exact name", () => {
  const tree = buildRedisKeyTree([":x"]);
  const x = find(tree, ":x");
  assert.ok(x, ":x node exists");
  assert.equal(x.fullKey, ":x");
  assert.equal(x.hasValue, true);
});

test("folders sort before leaves, alphabetical", () => {
  const tree = buildRedisKeyTree(["z", "mnt:inner", "mnt:a"]);
  assert.equal(tree[0].segment, "mnt", "folder first");
  assert.equal(tree[1].segment, "z");
  const mnt = tree[0];
  assert.deepEqual(
    mnt.children.map((child) => child.segment),
    ["a", "inner"],
  );
});
