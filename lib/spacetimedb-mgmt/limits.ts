// Totally free: no linked-account caps.
export const MAX_SPACETIMEDB_ACCOUNTS_FREE = null as number | null;

export function canAddSpacetimeDbAccount(
  _premiumActive: boolean,
  _currentCount: number,
): { allowed: true } | { allowed: false; reason: "free-limit" } {
  return { allowed: true };
}