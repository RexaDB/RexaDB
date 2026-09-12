"use client";

import { useAuthState } from "@/hooks/use-auth-state";
import { useEntitlementState } from "@/hooks/use-entitlement-state";
import { useSettingsSync } from "@/hooks/use-settings-sync";

/**
 * Background sync of themes, studio settings, font, and keybindings.
 * Free for all signed-in users (entitlement.cloudEnabled). Local mode stays device-local.
 */
export function SettingsSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accessToken, isSessionActive, localMode, user } = useAuthState();
  const { entitlement } = useEntitlementState({
    userId: isSessionActive ? (user?.id ?? null) : null,
    accessToken,
    isSessionActive,
  });

  const enabled = Boolean(
    isSessionActive && user?.id && entitlement.cloudEnabled && !localMode,
  );

  useSettingsSync({
    enabled,
    userId: enabled ? (user?.id ?? null) : null,
  });

  return <>{children}</>;
}
