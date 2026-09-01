export const MAX_PLANETSCALE_ACCOUNTS_FREE = 1;

export function canAddPlanetscaleAccount(
  premiumActive: boolean,
  currentCount: number,
): { allowed: true } | { allowed: false; reason: "free-limit" } {
  if (premiumActive) return { allowed: true };
  if (currentCount >= MAX_PLANETSCALE_ACCOUNTS_FREE) {
    return { allowed: false, reason: "free-limit" };
  }
  return { allowed: true };
}
