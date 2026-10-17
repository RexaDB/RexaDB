// Browser-safe. A single shared string so the server (which detects the
// real condition) and the UI (which offers a "Reconnect" action for it) never
// drift out of sync — matching error text across an HTTP JSON boundary is
// fragile enough without two independently-edited copies of it.
export const NEON_SESSION_EXPIRED_MESSAGE =
  "Your Neon session has expired. Reconnect to sign in again.";

/**
 * A refresh attempt could not even reach Neon (offline, VPN drop, 5xx). The
 * stored session is fine — the user just needs to retry, not re-authenticate.
 */
export const NEON_AUTH_UNAVAILABLE_MESSAGE =
  "Couldn't reach Neon just now. Check your connection and try again — your session is still valid.";

export function isNeonSessionExpiredError(message: string | null | undefined): boolean {
  return message === NEON_SESSION_EXPIRED_MESSAGE;
}

export function isNeonAuthUnavailableError(message: string | null | undefined): boolean {
  return message === NEON_AUTH_UNAVAILABLE_MESSAGE;
}
