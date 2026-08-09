"use client";

import type { User } from "@supabase/supabase-js";

import {
  clearAllUsers,
  getStoredUserProfile,
  upsertUserProfile,
} from "@/lib/api/actions-client";
import { supabase } from "@/lib/supabase/client";

export const LOCAL_MODE_STORAGE_KEY = "rexa-db-local-mode";
export const LOCAL_NAME_STORAGE_KEY = "rexa-db-local-name";
export const DISPLAY_NAME_STORAGE_KEY = "rexa-db-display-name";

type UserLike = Pick<User, "id" | "email" | "user_metadata">;

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isSameAsEmail(value: string | null, email: string | null) {
  if (!value || !email) return false;
  return value.localeCompare(email, undefined, { sensitivity: "accent" }) === 0;
}

function getUserMetadata(user: UserLike | null) {
  if (!user?.user_metadata || typeof user.user_metadata !== "object") {
    return {};
  }

  return user.user_metadata as Record<string, unknown>;
}

export function getSupabaseUserDisplayName(user: UserLike | null) {
  if (!user) return null;

  const email = normalizeText(user.email);
  const metadata = getUserMetadata(user);
  const candidates = [
    normalizeText(metadata.name),
    normalizeText(metadata.full_name),
    normalizeText(metadata.display_name),
  ];

  for (const candidate of candidates) {
    if (candidate && !isSameAsEmail(candidate, email)) {
      return candidate;
    }
  }

  return email;
}

function applySupabaseUserDisplayName<T extends UserLike>(user: T, name: string | null) {
  const trimmedName = normalizeText(name);
  if (!trimmedName) return user;

  return {
    ...user,
    user_metadata: {
      ...getUserMetadata(user),
      display_name: trimmedName,
    },
  } as T;
}

async function resolveSupabaseUserDisplayName(user: UserLike) {
  const email = normalizeText(user.email);
  let resolvedName = getSupabaseUserDisplayName(user);

  if (!resolvedName || isSameAsEmail(resolvedName, email)) {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle<{ full_name: string | null }>();

      const cloudName = normalizeText(data?.full_name);
      if (cloudName && !isSameAsEmail(cloudName, email)) {
        resolvedName = cloudName;
      }
    } catch {
      // Ignore profile lookup failures and fall back to local state.
    }
  }

  if (!resolvedName || isSameAsEmail(resolvedName, email)) {
    try {
      const storedProfile = await getStoredUserProfile(user.id);
      const storedName = normalizeText(storedProfile.data?.name);
      if (storedName) {
        resolvedName = storedName;
      }
    } catch {
      // Ignore local profile lookup failures and keep remaining fallbacks.
    }
  }

  return resolvedName ?? email;
}

function clearLocalModePreference() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_MODE_STORAGE_KEY);
  window.localStorage.removeItem(LOCAL_NAME_STORAGE_KEY);
  window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
}

function setLocalModePreference(name: string) {
  if (typeof window === "undefined") return;

  const trimmedName = normalizeText(name) ?? "Local";
  window.localStorage.setItem(LOCAL_MODE_STORAGE_KEY, "1");
  window.localStorage.setItem(LOCAL_NAME_STORAGE_KEY, trimmedName);
}

export function getStoredLocalModeName() {
  if (typeof window === "undefined") return null;
  if (window.localStorage.getItem(LOCAL_MODE_STORAGE_KEY) !== "1") return null;
  return normalizeText(window.localStorage.getItem(LOCAL_NAME_STORAGE_KEY));
}

export function loadStoredDisplayName(): string {
  if (typeof window === "undefined") return "";
  const localName = window.localStorage.getItem(LOCAL_NAME_STORAGE_KEY);
  if (localName?.trim()) return localName.trim();
  const displayName = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
  return displayName?.trim() ?? "";
}

export async function syncAuthenticatedUserProfile<T extends UserLike>(user: T) {
  const name = await resolveSupabaseUserDisplayName(user);
  clearLocalModePreference();

  if (name && typeof window !== "undefined") {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  }

  const result = await upsertUserProfile({
    id: user.id,
    email: normalizeText(user.email),
    name,
    isLocal: false,
    supabaseId: user.id,
  });

  return {
    name,
    result,
    user: applySupabaseUserDisplayName(user, name),
  };
}

export async function activateLocalUserProfile(name: string) {
  const trimmedName = normalizeText(name) ?? "Local";
  setLocalModePreference(trimmedName);

  try {
    await clearAllUsers();
  } catch {
    // Best-effort: proceed even if clear fails
  }

  const result = await upsertUserProfile({
    id: "local",
    name: trimmedName,
    isLocal: true,
  });

  return { name: trimmedName, result };
}
