/**
 * Resolve how an extension icon string renders.
 * - inline `<svg…>` → "svg" (rendered raw, user-installed trust level)
 * - short text/emoji (≤4 graphemes) → "text"
 * - anything else / omitted → "fallback" (puzzle icon)
 */
export function resolveExtensionIconKind(icon?: string): "svg" | "text" | "fallback" {
  const trimmed = (icon ?? "").trim();
  if (!trimmed) return "fallback";
  if (trimmed.startsWith("<svg")) return "svg";
  if ([...trimmed].length <= 4) return "text";
  return "fallback";
}

/**
 * Rail dedup rule (mirrors the activity-rail rendering): an extension that
 * declares explicit (non-auto) rail items suppresses its automatic
 * per-container entries, so manifests declaring both never produce 2 icons.
 * Auto container items have ids prefixed with `container:`.
 */
export function visibleContainerRailEntries<
  C extends { extensionId: string },
  R extends { extensionId: string; id: string },
>(containers: C[], railItems: R[]): C[] {
  const explicitOwners = new Set(
    railItems.filter((r) => !r.id.startsWith("container:")).map((r) => r.extensionId),
  );
  return containers.filter((c) => !explicitOwners.has(c.extensionId));
}
