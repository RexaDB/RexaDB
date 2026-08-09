"use client";

import { format } from "date-fns";
import { useAuthQuery } from "./use-auth-query";
import {
  AUTH_PROVIDER_ICONS,
  AUTH_PROVIDER_NAMES,
} from "../components/studio/auth/auth-providers-data";

interface AuthUserRow {
  UID: string;
  "Display name": string;
  Email: string | null;
  Phone: string | null;
  Providers: string;
  "Provider type": string;
  "Created at": string | null;
  "Last sign in at": string | null;
  __avatar_url?: string | null;
  __confirmed: boolean;
  __is_anonymous: boolean;
  __providers: string[];
  __provider_icons: string[];
  __created_at_raw?: string | null;
  __last_sign_in_at_raw?: string | null;
}

const SOCIAL_PROVIDERS = new Set([
  "apple",
  "auth0",
  "azure",
  "bitbucket",
  "discord",
  "facebook",
  "figma",
  "github",
  "gitlab",
  "google",
  "kakao",
  "keycloak",
  "linkedin",
  "notion",
  "slack",
  "spotify",
  "twitch",
  "twitter",
  "x",
  "workos",
  "zoom",
]);

const GITHUB_AVATAR_URL = "https://avatars.githubusercontent.com";
const SUPPORTED_CSP_AVATAR_URLS = [GITHUB_AVATAR_URL, "https://lh3.googleusercontent.com"];

const USERS_QUERY = `
  SELECT
    u.id,
    u.email,
    u.phone,
    u.created_at,
    u.last_sign_in_at,
    u.confirmed_at,
    u.email_confirmed_at,
    u.phone_confirmed_at,
    u.is_anonymous,
    u.raw_user_meta_data,
    COALESCE(string_agg(DISTINCT i.provider, ', '), CASE WHEN u.email IS NOT NULL THEN 'email' WHEN u.phone IS NOT NULL THEN 'phone' ELSE 'unknown' END) AS providers,
    COALESCE(string_agg(DISTINCT COALESCE(i.identity_data->>'provider_type', i.provider), ', '), CASE WHEN u.email IS NOT NULL THEN 'email' WHEN u.phone IS NOT NULL THEN 'phone' ELSE 'unknown' END) AS provider_type,
    COALESCE(jsonb_agg(DISTINCT i.identity_data) FILTER (WHERE i.identity_data IS NOT NULL), '[]'::jsonb) AS all_identity_data
  FROM auth.users u
  LEFT JOIN auth.identities i ON i.user_id = u.id
  GROUP BY u.id, u.email, u.phone, u.created_at, u.last_sign_in_at, u.confirmed_at, u.email_confirmed_at, u.phone_confirmed_at, u.is_anonymous, u.raw_user_meta_data
  ORDER BY u.created_at DESC
  LIMIT 200;
`;

function formatSupabaseDate(value: unknown): string | null {
  if (!value) return null;
  try {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    return format(date, "EEE dd MMM yyyy HH:mm:ss 'GMT'xx");
  } catch {
    return null;
  }
}

function mapProviderType(providerType: string, isAnonymous: boolean): string {
  if (isAnonymous) return "Anonymous";
  const tokens = String(providerType || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return "-";
  if (tokens.some((token) => token.includes("sso"))) return "SAML";
  if (tokens.some((token) => SOCIAL_PROVIDERS.has(token))) return "Social";
  if (tokens.some((token) => token.includes("phone"))) return "Phone";
  return "-";
}

function getAvatarUrl(meta: Record<string, unknown>): string | null {
  const url = (meta?.avatar_url ||
    meta?.avatarURL ||
    meta?.profileUrl ||
    meta?.profileURL ||
    meta?.profile_url ||
    meta?.profileImage ||
    meta?.profile_image ||
    meta?.profileImageUrl ||
    meta?.profileImageURL ||
    meta?.profile_image_url ||
    "") as unknown;
  if (typeof url !== "string" || !url.trim()) return null;
  const isSupported = SUPPORTED_CSP_AVATAR_URLS.some((host) => url.startsWith(host));
  if (!isSupported) return null;
  try {
    const parsed = new URL(url);
    if (url.startsWith(GITHUB_AVATAR_URL)) {
      parsed.searchParams.set("s", "24");
      return parsed.href;
    }
    return url;
  } catch {
    return isSupported ? url : null;
  }
}

function mapUserRow(row: any): AuthUserRow {
  const meta = row?.raw_user_meta_data || {};
  const displayName =
    (typeof meta?.full_name === "string" && meta.full_name.trim())
    || (typeof meta?.name === "string" && meta.name.trim())
    || (typeof meta?.display_name === "string" && meta.display_name.trim())
    || (typeof row?.email === "string" ? row.email.split("@")[0] : "—");

  let avatarUrl: string | null = null;
  const metaAvatar = getAvatarUrl(meta);
  if (metaAvatar) {
    avatarUrl = metaAvatar;
  } else if (row?.all_identity_data) {
    try {
      const identityDataArray = Array.isArray(row.all_identity_data) ? row.all_identity_data : [];
      for (const identityData of identityDataArray) {
        if (typeof identityData === "object" && identityData) {
          const candidate = getAvatarUrl(identityData as Record<string, unknown>);
          if (candidate) {
            avatarUrl = candidate;
            break;
          }
        }
      }
    } catch {}
  }

  const isAnonymous = row?.is_anonymous === true || row?.is_anonymous === "true";
  const rawProviders = String(row?.providers || "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  const providerList = isAnonymous
    ? ["-"]
    : rawProviders.length
      ? rawProviders.map((provider) => (provider.startsWith("sso") ? "SAML" : provider))
      : ["-"];
  const providerIcons = isAnonymous
    ? []
    : providerList.map((provider) => {
        if (provider.startsWith("custom:")) return "custom";
        const key = provider.toLowerCase();
        if (key === "saml") return AUTH_PROVIDER_ICONS.saml ?? "";
        return AUTH_PROVIDER_ICONS[key] ?? "";
      });
  const confirmed = Boolean(
    row?.confirmed_at || row?.email_confirmed_at || row?.phone_confirmed_at,
  );

  return {
    UID: String(row?.id || ""),
    "Display name": String(displayName || "—"),
    Email: row?.email ?? null,
    Phone: row?.phone ?? null,
    Providers: providerList.map((p) => AUTH_PROVIDER_NAMES[p] ?? p).join(", "),
    "Provider type": mapProviderType(row?.provider_type, isAnonymous),
    "Created at": formatSupabaseDate(row?.created_at),
    "Last sign in at": formatSupabaseDate(row?.last_sign_in_at),
    __avatar_url: avatarUrl,
    __confirmed: confirmed,
    __is_anonymous: isAnonymous,
    __providers: providerList,
    __provider_icons: providerIcons,
    __created_at_raw: row?.created_at ?? null,
    __last_sign_in_at_raw: row?.last_sign_in_at ?? null,
  } satisfies AuthUserRow;
}

export function useAuthUsers(connectionString: string, enabled: boolean) {
  const { data: users, loading, error, refresh } = useAuthQuery<AuthUserRow>(
    connectionString,
    enabled,
    USERS_QUERY,
    "Failed to load users.",
    mapUserRow,
  );

  return { users, loading, error, refresh };
}
