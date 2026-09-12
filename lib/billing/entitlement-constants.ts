export const ENTITLEMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const ENTITLEMENT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
export const ENTITLEMENT_CHANGED_EVENT = "billing:entitlement-changed";
export const ENTITLEMENT_REFRESH_PENDING_STORAGE_KEY = "rexa-db-entitlement-refresh-pending";
// Everything is free in 1.3.11+: null = unlimited, no connection/workspace caps.
export const DEFAULT_FREE_MAX_CONNECTIONS: number | null = null;
export const DEFAULT_FREE_MAX_WORKSPACES: number | null = null;

export const DEV_ENTITLEMENT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYwttP8w12AlJUi49zfgkAQO4wpPMXc2uh2XZV2K+Zis=
-----END PUBLIC KEY-----`;
