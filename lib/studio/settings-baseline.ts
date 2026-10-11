/**
 * Pure baseline helpers for global studio settings sync.
 *
 * The problem: several hook instances (and cloud sync) read/write the same
 * settings record concurrently. A field the user touched locally must survive
 * incoming loads/broadcasts, while untouched fields follow the server.
 *
 * Two records disambiguate:
 * - `baseline` (last server-acknowledged state): a field whose current value
 *   differs from baseline is a real unsaved edit and must be preserved.
 * - recovery reads (e.g. the wake after a failed save) apply WITHOUT
 *   confirming, so unsaved edits stay dirty until a save succeeds. Confirming
 *   them would make a second failed retry see no diff and restore stale
 *   server values, discarding the edit.
 * - confirming MERGES onto the previous baseline because incoming records can
 *   be sparse (empty/older settings omit fields that fall back to defaults).
 *   Replacing the baseline with a sparse record would make untouched defaults
 *   look dirty and permanently reject later cloud updates for them.
 */

/** Order-insensitive deep equality for settings records. */
export function stableStringifySettings(value: unknown): string {
  if (value === null || typeof value !== "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return "";
    }
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifySettings).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringifySettings(record[k])}`)
    .join(",")}}`;
}

function settingsEqual(a: unknown, b: unknown): boolean {
  return stableStringifySettings(a) === stableStringifySettings(b);
}

/**
 * Overlay `incoming` server state while preserving fields the user edited
 * locally (current differs from baseline). Returns the state to apply.
 */
export function mergePreservingEdits(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...incoming };
  for (const key of Object.keys(current)) {
    if (!settingsEqual(current[key], baseline[key])) {
      merged[key] = current[key];
    }
  }
  return merged;
}

/**
 * Advance the server-acknowledged baseline with a confirmed-fresh record.
 * Merges onto the previous baseline so sparse records can't mark untouched
 * defaults dirty.
 */
export function confirmSettingsBaseline(
  prevBaseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...prevBaseline, ...incoming };
}
