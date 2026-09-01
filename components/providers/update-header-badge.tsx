"use client";

import { Download, CheckCircle2, Loader2, ExternalLink } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { useAppUpdateContext } from "@/components/providers/app-update-context";
import { useAuthState } from "@/hooks/use-auth-state";
import { useEntitlementState } from "@/hooks/use-entitlement-state";

type Variant = "modern" | "command";

/**
 * In-header update badge that mirrors the adjacent search bar's size/style.
 * - modern:  h-6  rounded-sm  bg-sidebar  border-border/70  text-[11px]  (ModernUISearchBar)
 * - command: h-8/h-9 rounded-lg bg-background/15 border-studio-border text-xs (CommandSearchBar)
 * Shows right after the search bar in app headers.
 */
export function UpdateHeaderBadge({
  className,
  variant = "modern",
  sleekLayout = false,
}: {
  className?: string;
  variant?: Variant;
  sleekLayout?: boolean;
}) {
  const {
    updateState,
    installing,
    dismissed,
    setDismissed,
    handleDownload,
    handleInstall,
    handleRenewOtl,
  } = useAppUpdateContext();

  const { checking, updateAvailable, downloading, updateDownloaded, progressPercent } =
    updateState;

  const { accessToken, user, isSessionActive } = useAuthState();
  const { entitlement } = useEntitlementState({
    userId: isSessionActive ? user?.id ?? null : null,
    accessToken,
    isSessionActive,
  });
  const updatesExpired = entitlement.updatesExpired;

  if (!updateState.enabled) return null;
  if (checking) return null;
  if (!updateAvailable && !downloading && !updateDownloaded) return null;
  if (dismissed) return null;

  const isModern = variant === "modern";

  // Mirror the sibling search bar exactly (VS Code header: reduced py/radius) — border matches sidebar (border-border)
  const baseClasses = isModern
    ? "group flex h-[22px] select-none items-center gap-1.5 rounded-[4px] border border-border bg-sidebar px-2.5 text-[11px] leading-none text-muted-foreground transition-colors hover:border-border hover:text-foreground no-drag"
    : cn(
        "group flex select-none items-center gap-1.5 rounded-lg border border-studio-border bg-background/15 px-3 text-xs text-muted-foreground transition-colors hover:bg-background/25 hover:text-foreground no-drag",
        sleekLayout ? "h-8" : "h-9",
      );

  const iconClasses = isModern ? "size-3 shrink-0" : sleekLayout ? "w-3 h-3 shrink-0" : "w-3.5 h-3.5 shrink-0";

  // Expired -> Renew (amber tint but same shell)
  if (updatesExpired && updateAvailable) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <button
          onClick={() => void handleRenewOtl()}
          className={cn(baseClasses, "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15 hover:border-amber-500/40 hover:text-amber-300")}
        >
          <ExternalLink className={iconClasses} />
          <span className="truncate">Renew to update{updateState.latestVersion ? ` · v${updateState.latestVersion}` : ""}</span>
        </button>
        <button
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-white/10 no-drag"
        >
          ×
        </button>
      </div>
    );
  }

  if (updateDownloaded) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <button
          onClick={() => void handleInstall()}
          disabled={installing}
          className={cn(baseClasses, "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15 hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-60")}
        >
          <CheckCircle2 className={iconClasses} />
          <span className="truncate">Restart to apply{updateState.latestVersion ? ` · v${updateState.latestVersion}` : ""}</span>
        </button>
        <button
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-white/10 no-drag"
        >
          ×
        </button>
      </div>
    );
  }

  if (downloading) {
    return (
      <div className={cn(baseClasses, "text-blue-400 border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/15 hover:border-blue-500/40", className)}>
        <Loader2 className={cn(iconClasses, "animate-spin")} />
        <span className="truncate">Downloading{progressPercent !== null ? ` ${progressPercent}%` : "..."}</span>
        {progressPercent !== null && !isModern && (
          <div className="w-10 h-1 rounded-full bg-blue-500/20 overflow-hidden shrink-0">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </div>
    );
  }

  // updateAvailable
  return (
    <button
      onClick={() => void handleDownload()}
      className={cn(baseClasses, "border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 hover:border-blue-500/40 hover:text-blue-300", className)}
    >
      <Download className={iconClasses} />
      <span className="truncate">
        <span className="hidden sm:inline">Update available</span>
        <span className="sm:hidden">Update</span>
        {updateState.latestVersion ? ` · v${updateState.latestVersion}` : ""}
      </span>
    </button>
  );
}
