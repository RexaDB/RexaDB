"use client";

import { useState, useEffect, type ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { CommandSearchBar } from "@/components/ui/command-search-bar";
import { UserAvatarDropdown } from "@/components/ui/user-avatar-dropdown";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Settings,
  BarChart3,
  Activity,
  ArrowLeft,
  Server,
} from "@/lib/icon-theme/lucide-react";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import { supabase } from "@/lib/supabase/client";
import { getStoredUserProfile } from "@/lib/api/actions-client";
import { loadStoredDisplayName, syncAuthenticatedUserProfile } from "@/lib/auth/user-profile";
import { WindowControls } from "@/components/shared/window-controls";
import { HeaderIconButton } from "@/components/shared/header-icon-button";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

export function ConnectionsHeader({
  displayName: externalDisplayName,
  showBackButton,
  onBack,
  onCommandSearchClick,
  showAnalyticsToggle,
  isAnalyticsEnabled,
  onAnalyticsToggle,
  showActivityButton,
  activityActive,
  onActivityClick,
  settingsActive,
  onSettingsClick,
  supabaseActive,
  onSupabaseClick,
  avatarDropdownChildren,
}: {
  displayName?: string;
  showBackButton?: boolean;
  onBack?: () => void;
  onCommandSearchClick?: () => void;
  showAnalyticsToggle?: boolean;
  isAnalyticsEnabled?: boolean;
  onAnalyticsToggle?: (enabled: boolean) => void;
  showActivityButton?: boolean;
  activityActive?: boolean;
  onActivityClick?: () => void;
  settingsActive?: boolean;
  onSettingsClick?: () => void;
  supabaseActive?: boolean;
  onSupabaseClick?: () => void;
  avatarDropdownChildren?: ReactNode;
}) {
  const { sleekLayout, hideWindowActions } = useGlobalStudioSettings();
  const { isMaximized, sendWindowAction, canUseDesktop, isMac, isLinuxCloseOnly } = useDesktopWindow();
  const [user, setUser] = useState<User | null>(null);
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [localMode, setLocalMode] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedName = loadStoredDisplayName();
    if (storedName) {
      setLocalDisplayName(storedName);
    }
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          setUser(data.session.user);
          setIsSessionActive(true);
          setLocalMode(false);
          const syncedProfile = await syncAuthenticatedUserProfile(data.session.user);
          if (syncedProfile.result.success && syncedProfile.user) {
            setUser(syncedProfile.user);
          }
          return;
        }
        const profile = await getStoredUserProfile();
        if (profile.success && profile.data) {
          setLocalDisplayName(profile.data.name || "User");
          setLocalMode(true);
        }
      } catch {}
    };
    void hydrate();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out.");
  };

  // fallow-ignore-next-line code-duplication
  const internalDisplayName =
    (typeof user?.user_metadata?.name === "string" && user.user_metadata.name.trim()) ||
    (typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user?.user_metadata?.display_name === "string" && user.user_metadata.display_name.trim()) ||
    user?.email?.split("@")[0] ||
    localDisplayName.trim() ||
    "User";

  const displayName = externalDisplayName || internalDisplayName;

  return (
    <header
      className={cn(
        "app-drag-region flex items-center justify-between px-4 shrink-0 z-20 bg-studio-header-bg/90 backdrop-blur-xl transition-all duration-300",
        "h-14 border-b border-studio-border",
      )}
      data-tauri-drag-region="deep"
    >
      <div className="flex items-center gap-2 w-1/3">
        {isMac && <div className="w-[72px] shrink-0" />}
        {!isMac && (
          <UserAvatarDropdown
            displayName={displayName}
            user={user}
            isSessionActive={isSessionActive}
            localMode={localMode}
            onOpenSettings={() => {}}
            onLogout={handleLogout}
            sleekLayout={sleekLayout}
          >
            {avatarDropdownChildren || (
              <>
                <DropdownMenuSeparator className="bg-studio-border" />
                <DropdownMenuItem
                  onClick={() => (window.location.href = "/team")}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <Server className="w-3.5 h-3.5" />
                  Workspace Studio
                </DropdownMenuItem>
              </>
            )}
          </UserAvatarDropdown>
        )}
        {showBackButton && onBack && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-1 text-muted-foreground hover:text-foreground",
              sleekLayout ? "h-8 text-xs" : "h-9",
            )}
            onClick={onBack}
          >
            <ArrowLeft className={sleekLayout ? "w-3.5 h-3.5" : "w-4 h-4"} />
            Back
          </Button>
        )}
      </div>
      <CommandSearchBar
        sleekLayout={sleekLayout}
        noDrag
        onClick={onCommandSearchClick}
      />
      <div className="flex items-center justify-end gap-3 w-1/3">
        {showAnalyticsToggle && onAnalyticsToggle && (
          <HeaderIconButton
            icon={BarChart3}
            onClick={() => onAnalyticsToggle(!isAnalyticsEnabled)}
            title={isAnalyticsEnabled ? "Analytics on" : "Analytics off"}
            active={isAnalyticsEnabled}
            sleekLayout={sleekLayout}
            native={!isMac}
          />
        )}
        {showActivityButton && (
          <HeaderIconButton
            icon={Activity}
            onClick={onActivityClick || (() => {})}
            title={activityActive ? "Hide activity overview" : "Show activity overview"}
            active={activityActive}
            sleekLayout={sleekLayout}
            native={!isMac}
          />
        )}
        <button
          onClick={onSupabaseClick ?? (() => {})}
          title={supabaseActive ? "Close Supabase" : "Supabase accounts"}
          className={cn(
            "flex items-center justify-center transition-colors no-drag",
            !isMac
              ? "h-8 w-8 hover:bg-studio-border/50"
              : "border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
            !isMac ? "rounded" : sleekLayout ? "h-8 w-8" : "h-9 w-9",
          )}
        >
          <Image
            src="/providers/supabase.png"
            alt="Supabase"
            width={16}
            height={16}
            className={cn(
              "rounded-[3px] object-contain",
              sleekLayout ? "w-3.5 h-3.5" : "w-4 h-4",
              supabaseActive ? "" : "opacity-60",
            )}
          />
        </button>
        <HeaderIconButton
          icon={Settings}
          onClick={onSettingsClick || (() => {})}
          title={settingsActive ? "Close settings" : "Settings"}
          active={settingsActive}
          sleekLayout={sleekLayout}
          native={!isMac}
        />
        {isMac && (
          <UserAvatarDropdown
            displayName={displayName}
            user={user}
            isSessionActive={isSessionActive}
            localMode={localMode}
            onOpenSettings={() => {}}
            onLogout={handleLogout}
            sleekLayout={sleekLayout}
          >
            {avatarDropdownChildren || (
              <>
                <DropdownMenuSeparator className="bg-studio-border" />
                <DropdownMenuItem
                  onClick={() => (window.location.href = "/team")}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <Server className="w-3.5 h-3.5" />
                  Workspace Studio
                </DropdownMenuItem>
              </>
            )}
          </UserAvatarDropdown>
        )}

        {canUseDesktop && !isMac && (!hideWindowActions || isLinuxCloseOnly) && (
          <WindowControls
            isMaximized={isMaximized}
            onMinimize={() => sendWindowAction("minimize")}
            onMaximizeToggle={() => sendWindowAction("maximize-toggle")}
            onClose={() => sendWindowAction("close")}
            wayland={isLinuxCloseOnly}
          />
        )}
      </div>
    </header>
  );
}
