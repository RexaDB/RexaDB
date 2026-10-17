export interface RedisKeyTreeNode {
  /**
   * Display segment. May be "" for empty segments in keys like "a::b" —
   * the UI renders those with a visible placeholder (see
   * EMPTY_SEGMENT_LABEL) but MUST NOT drop them, so that joined paths
   * always round-trip to the exact original key name.
   */
  segment: string;
  /** Full key path from the root. For every real key this equals the exact original key text. */
  fullKey: string;
  /** True when a real Redis key terminates at this node. */
  hasValue: boolean;
  children: RedisKeyTreeNode[];
}

/** Visible placeholder for empty segments (keys like "a::b" or ":"). */
export const EMPTY_SEGMENT_LABEL = '""';

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
 * IMPORTANT: empty segments are preserved, never dropped. "a::b" nests as
 * a › "" › b with fullKey "a::b" — so it stays distinct from "a:b" and
 * opening it always targets the literal key name. Filter the key list
 * BEFORE building the tree so that ancestor segments of matching keys
 * stay visible.
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
    // Keep every segment, including empty ones — dropping them would
    // rename keys ("a::b" → "a:b") and merge distinct originals.
    const segments = name.split(":");
    if (segments.length === 0) continue;

    let node = root;
    // null = no segments consumed yet. Unlike a ""-check this handles a
    // leading empty segment correctly (":x" → first segment fullKey "").
    let path: string | null = null;
    for (const segment of segments) {
      path = path === null ? segment : `${path}:${segment}`;
      let child = node.children.find((entry) => entry.segment === segment);
      if (!child) {
        child = {
          segment,
          fullKey: path,
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
