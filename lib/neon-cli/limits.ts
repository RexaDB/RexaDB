export const MAX_NEON_ACCOUNTS_FREE = 1;

export function canAddNeonAccount(
  premiumActive: boolean,
  currentCount: number,
): { allowed: true } | { allowed: false; reason: "free-limit" } {
  if (premiumActive) return { allowed: true };
  if (currentCount >= MAX_NEON_ACCOUNTS_FREE) {
    return { allowed: false, reason: "free-limit" };
  }
  return { allowed: true };
}
