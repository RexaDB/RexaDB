// Browser-safe. A single shared string so the server (which detects the
// real condition) and the UI (which offers a "Reconnect" action for it) never
// drift out of sync — matching error text across an HTTP JSON boundary is
// fragile enough without two independently-edited copies of it.
export const NEON_SESSION_EXPIRED_MESSAGE =
  "Your Neon session has expired. Reconnect to sign in again.";

export function isNeonSessionExpiredError(message: string | null | undefined): boolean {
  return message === NEON_SESSION_EXPIRED_MESSAGE;
}
