export interface RedisKeyTreeNode {
  /** Display segment, e.g. "id" for key "org:id". */
  segment: string;
  /** Full key path from the root, e.g. "org:id". */
  fullKey: string;
  /** True when a real Redis key terminates at this node. */
  hasValue: boolean;
  children: RedisKeyTreeNode[];
}

function sortNodes(nodes: RedisKeyTreeNode[]): void {
  nodes.sort((a, b) => {
    const aFolder = a.children.length > 0 ? 0 : 1;
    const bFolder = b.children.length > 0 ? 0 : 1;
    if (aFolder !== bFolder) return aFolder - bFolder;
    return a.segment.localeCompare(b.segment);
  });
  for (const node of nodes) sortNodes(node.children);
}

/**
 * Builds a nested tree from flat Redis key names by splitting on ":".
 *
 * Hybrid keys are preserved: "org:id" and "org:id:status" produce an "id"
 * node that is both a key (hasValue = true, clickable to open the value of
 * "org:id") and a parent ("org:id:status" nests underneath it).
 *
 * Filter the key list BEFORE building the tree so that parent segments of
 * matching keys stay visible.
 */
export function buildRedisKeyTree(keyNames: string[]): RedisKeyTreeNode[] {
  const root: RedisKeyTreeNode = {
    segment: "",
    fullKey: "",
    hasValue: false,
    children: [],
  };

  for (const rawName of keyNames) {
    const name = String(rawName ?? "");
    // Skip empty segments ("a::b" → a › b; ":x" → x).
    const segments = name.split(":").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let node = root;
    for (const segment of segments) {
      let child = node.children.find((entry) => entry.segment === segment);
      if (!child) {
        child = {
          segment,
          fullKey: node.fullKey ? `${node.fullKey}:${segment}` : segment,
          hasValue: false,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
    node.hasValue = true;
  }

  sortNodes(root.children);
  return root.children;
}
