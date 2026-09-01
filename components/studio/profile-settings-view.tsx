"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthState } from "@/hooks/use-auth-state";
import { useEntitlementState } from "@/hooks/use-entitlement-state";
import { useSettingsSyncStatus } from "@/hooks/use-settings-sync-status";
import {
  buildEntitlementCacheMessage,
  buildEntitlementProfileMeta,
  formatEntitlementPlanLabel,
} from "@/lib/billing/entitlement-display";
import { supabase } from "@/lib/supabase/client";
import { openExternalUrl } from "@/lib/desktop";
import { REXADB_UPGRADE_URL } from "@/lib/constants";

interface ProfileRecord {
  id: string;
  email: string;
  full_name: string | null;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getNameFromMetadata(user: any): string {
  const meta = user?.user_metadata;
  return (
    (typeof meta?.name === "string" ? meta.name : null) ||
    (typeof meta?.full_name === "string" ? meta.full_name : null) ||
    (typeof meta?.display_name === "string" ? meta.display_name : null) ||
    ""
  );
}

export function ProfileSettingsView() {
  const { accessToken, authResolved, isSessionActive, localDisplayName, user } =
    useAuthState();
  const { entitlement, refreshEntitlement } = useEntitlementState({
    userId: isSessionActive ? (user?.id ?? null) : null,
    accessToken,
    isSessionActive,
  });
  const {
    status: settingsSyncStatus,
    lastSyncedAt,
    error: settingsSyncError,
    enabled: settingsSyncEnabled,
    syncNow,
  } = useSettingsSyncStatus();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileEmail, setProfileEmail] = useState("");
  const [profileFullName, setProfileFullName] = useState("");
  const [initialProfileFullName, setInitialProfileFullName] = useState("");
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    setIsProfileLoading(true);
    try {
      if (!authResolved) {
        return;
      }

      if (isSessionActive && user) {
        setProfileId(user.id);

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .eq("id", user.id)
          .maybeSingle<ProfileRecord>();

        if (profileError) throw profileError;

        if (profile) {
          setProfileEmail(profile.email || user.email || "");
          const name =
            profile.full_name ||
            getNameFromMetadata(user) ||
            "";
          setProfileFullName(name);
          setInitialProfileFullName(name);
          return;
        }

        const fallbackEmail = user.email || "";

        const fallbackName = getNameFromMetadata(user);

        setProfileEmail(fallbackEmail);
        setProfileFullName(fallbackName);
        setInitialProfileFullName(fallbackName);
        return;
      }

      setProfileId(null);
      setProfileEmail("");
      setProfileFullName("");
      setInitialProfileFullName("");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to load profile settings."));
    } finally {
      setIsProfileLoading(false);
    }
  }, [authResolved, isSessionActive, user]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSaveProfile = async () => {
    if (!profileId) {
      toast.error("You must be signed in to update your profile.");
      return;
    }

    const nextEmail = profileEmail.trim().toLowerCase();
    const nextName = profileFullName.trim();
    if (!nextEmail) {
      toast.error("Email is required.");
      return;
    }

    setIsProfileSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          email: nextEmail,
          full_name: nextName || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profileId);

      if (error) throw error;

      setInitialProfileFullName(nextName);
      toast.success("Profile updated.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update profile."));
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleCancel = () => {
    setProfileFullName(initialProfileFullName);
  };

  const handleUpgradeClick = () => {
    openExternalUrl(REXADB_UPGRADE_URL);
  };

  const avatarLetter = (profileFullName.trim() || profileEmail.trim() || "U")
    .charAt(0)
    .toUpperCase();
  const hasProfileChanges =
    profileFullName.trim() !== initialProfileFullName.trim();
  const subscriptionPlanCode = entitlement.effectivePlanCode || "free";
  const subscriptionLabel = formatEntitlementPlanLabel(subscriptionPlanCode);
  const subscriptionMeta = buildEntitlementProfileMeta(entitlement);
  const subscriptionNotice = buildEntitlementCacheMessage(entitlement);

  if (!authResolved || isProfileLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Loading profile...</div>
      </div>
    );
  }

  if (!isSessionActive || !profileId) {
    const localInitial = (localDisplayName.trim() || "L")
      .charAt(0)
      .toUpperCase();
    return (
      <div className="flex-1 overflow-auto bg-background text-foreground h-full">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-8">
          <div className="mx-auto flex h-full w-full max-w-xl flex-col px-2 pt-10 space-y-6">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border/60 bg-primary text-sm font-semibold text-primary-foreground">
                {localInitial}
              </div>
              <h3 className="text-sm font-semibold">
                {localDisplayName || "Local User"}
              </h3>
              <span className="inline-flex h-8 items-center rounded-lg border border-studio-border bg-secondary/40 px-3 text-xs font-medium text-muted-foreground">
                Local Mode
              </span>
              <p className="text-xs text-muted-foreground">
                Local data only • Cloud disabled
              </p>
            </div>
            <div className="rounded-lg border border-studio-border bg-studio-bg/40 p-6 space-y-3 text-center">
              <p className="text-xs text-muted-foreground">
                Sign in to manage subscriptions and cloud sync.
              </p>
              <Button
                type="button"
                className="h-9 px-4 text-sm bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.localStorage.removeItem("rexa-db-local-mode");
                    const redirectUrl = encodeURIComponent(
                      window.location.pathname + window.location.search,
                    );
                    window.location.href = `/auth?redirect_to=${redirectUrl}`;
                  }
                }}
              >
                Sign In
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-background text-foreground h-full">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-8">
        <div className="mx-auto flex h-full w-full max-w-xl flex-col px-2 pt-10 space-y-8">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border/60 bg-primary text-sm font-semibold text-primary-foreground">
              {avatarLetter}
            </div>
            <span className="inline-flex h-8 items-center rounded-lg border border-studio-border bg-secondary/40 px-3 text-xs font-medium text-muted-foreground">
              {subscriptionLabel}
            </span>
            <p className="text-xs text-muted-foreground">{subscriptionMeta}</p>
            {subscriptionNotice ? (
              <p className="max-w-sm text-center text-xs text-muted-foreground">
                {subscriptionNotice}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void refreshEntitlement("profile-settings")}
              className="h-8 px-3 text-xs"
            >
              Refresh Subscription
            </Button>
            {!isProfileLoading && subscriptionPlanCode === "free" ? (
              <Button
                type="button"
                onClick={handleUpgradeClick}
                className="h-8 gap-1.5 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
              >
                Upgrade on Website
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>

          <div className="rounded-lg border border-studio-border bg-studio-bg/40 p-4 space-y-3">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Settings Sync</h4>
              <p className="text-xs text-muted-foreground">
                Themes, studio settings, and keybindings sync across devices on
                paid plans. Agent API keys stay on this device.
              </p>
            </div>
            {settingsSyncEnabled || entitlement.cloudEnabled ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {settingsSyncStatus === "syncing"
                    ? "Syncing…"
                    : settingsSyncStatus === "error"
                      ? settingsSyncError || "Sync failed"
                      : settingsSyncStatus === "synced"
                        ? lastSyncedAt
                          ? `Synced ${new Date(lastSyncedAt).toLocaleString()}`
                          : "Synced"
                        : "Ready to sync"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  disabled={settingsSyncStatus === "syncing"}
                  onClick={() => void syncNow()}
                >
                  Sync Now
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro or higher to sync preferences across devices.
                </p>
                {subscriptionPlanCode === "free" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 gap-1.5 px-3 text-xs"
                    onClick={handleUpgradeClick}
                  >
                    Upgrade on Website
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-10 space-y-2">
            <Label htmlFor="profile-full-name" className="text-sm font-medium">
              Name
            </Label>
            <Input
              id="profile-full-name"
              value={profileFullName}
              onChange={(e) => setProfileFullName(e.target.value)}
              disabled={isProfileLoading || !profileId}
              placeholder="Lark"
              className="h-10 rounded-lg border-studio-border bg-background text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Your display name (optional)
            </p>
          </div>

          <div className="mt-4 min-h-5 text-xs text-muted-foreground">
            {!profileId ? "Sign in to edit profile settings." : ""}
          </div>

          <div className="mt-auto flex items-center justify-center gap-3 pb-4 pt-8">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isProfileLoading || isProfileSaving}
              className="h-9 min-w-28 border-studio-border bg-transparent text-sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveProfile}
              disabled={
                isProfileLoading ||
                isProfileSaving ||
                !profileId ||
                !hasProfileChanges
              }
              className="h-9 min-w-36 bg-primary text-sm text-primary-foreground hover:bg-primary/90"
            >
              {isProfileSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
