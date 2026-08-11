export const MAX_SPACETIMEDB_ACCOUNTS_FREE = 1;

export function canAddSpacetimeDbAccount(
  premiumActive: boolean,
  currentCount: number,
): { allowed: true } | { allowed: false; reason: "free-limit" } {
  if (premiumActive) return { allowed: true };
  if (currentCount >= MAX_SPACETIMEDB_ACCOUNTS_FREE) {
    return { allowed: false, reason: "free-limit" };
  }
  return { allowed: true };
}