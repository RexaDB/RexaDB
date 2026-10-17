/** Neon OAuth + API constants — mirrors neonctl defaults (public client_id "neonctl"). */

export const NEON_OAUTH_HOST =
  process.env.NEON_OAUTH_HOST ?? "https://oauth2.neon.tech";

export const NEON_API_HOST =
  process.env.NEON_API_HOST ?? "https://console.neon.tech/api/v2";

/** Public OAuth client id used by the official Neon CLI. */
export const NEON_OAUTH_CLIENT_ID = "neonctl";

export const NEON_OAUTH_SCOPES = [
  "openid",
  "offline",
  "offline_access",
  "urn:neoncloud:projects:create",
  "urn:neoncloud:projects:read",
  "urn:neoncloud:projects:update",
  "urn:neoncloud:projects:delete",
  "urn:neoncloud:orgs:create",
  "urn:neoncloud:orgs:read",
  "urn:neoncloud:orgs:update",
  "urn:neoncloud:orgs:delete",
  "urn:neoncloud:orgs:permission",
] as const;

export const NEON_AUTH_TIMEOUT_MS = 60_000;

export const DEFAULT_PROFILE = "DEFAULT";
