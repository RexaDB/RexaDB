"use client";

import { useRef, useEffect } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X, Download, RefreshCw, CheckCircle2, ExternalLink } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";
import { useAuthState } from "@/hooks/use-auth-state";
import { useEntitlementState } from "@/hooks/use-entitlement-state";
import { buildEntitlementCacheMessage } from "@/lib/billing/entitlement-display";
import { useAppUpdate } from "@/hooks/use-app-update";

export function UpdateNotificationProvider({ children }: { children: React.ReactNode }) {
  const {
    updateState,
    installing,
    dismissed,
    setDismissed,
    handleDownload,
    handleInstall,
    handleDismiss,
    handleOpenRelease,
    handleRenewOtl,
  } = useAppUpdate();
  const { accessToken, user, isSessionActive } = useAuthState();
  const { entitlement } = useEntitlementState({
    userId: isSessionActive ? user?.id ?? null : null,
    accessToken,
    isSessionActive,
  });

  const updatesUntil = entitlement.updatesUntil;
  const updatesExpired = entitlement.updatesExpired;
  const entitlementNotice = buildEntitlementCacheMessage(entitlement);

  useEffect(() => {
    // Pause updates when expired — handled via @tauri-apps/plugin-updater
  }, [updatesExpired]);

  const showOverlay =
    updateState.enabled &&
    !updateState.checking &&
    (updateState.updateAvailable || updateState.downloading || updateState.updateDownloaded) &&
    !dismissed &&
    !updatesExpired;

  const showRenewalPrompt = updateState.updateAvailable && updatesExpired && !dismissed;

  return (
    <>
      {children}
      {showOverlay && (
        <div className="fixed bottom-4 right-4 z-[9999] w-96 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <Card className="ring-foreground/10 shadow-xl border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {updateState.updateDownloaded ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : updateState.downloading ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                ) : (
                  <Download className="h-4 w-4 text-blue-500" />
                )}
                {updateState.updateDownloaded
                  ? "Update Ready"
                  : updateState.downloading
                  ? "Downloading Update..."
                  : "Update Available"}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleDismiss}
              >
                <X className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent className="pb-2">
              {updateState.latestVersion && (
                <p className="text-xs text-muted-foreground mb-2">
                  Version {updateState.latestVersion} is available (current: {updateState.currentVersion})
                </p>
              )}
              {updateState.downloading && updateState.progressPercent !== null && (
                <Progress value={updateState.progressPercent} className="h-2" />
              )}
              {updateState.error && (
                <p className="text-xs text-destructive">{updateState.error}</p>
              )}
            </CardContent>
            <CardFooter className="justify-center py-2">
              {updateState.updateDownloaded ? (
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={installing}
                >
                  {installing ? "Restarting..." : "Restart to Apply"}
                </Button>
              ) : updateState.downloading ? (
                <Button size="sm" disabled>
                  Downloading...
                </Button>
              ) : updateState.manualUpdate ? (
                <Button size="sm" onClick={handleOpenRelease}>
                  <ExternalLink className="mr-1.5 h-3 w-3" />
                  Download from GitHub
                </Button>
              ) : (
                <Button size="sm" onClick={handleDownload}>
                  Download Update
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      )}
      {showRenewalPrompt && (
        <div className="fixed bottom-4 right-4 z-[9999] w-96 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <Card className="ring-foreground/10 shadow-xl border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Updates Expired</CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleDismiss}>
                <X className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent className="pb-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                v{updateState.latestVersion} available
              </p>
              <p className="text-xs text-muted-foreground">
                Your update window expired. License is perpetual.
              </p>
              {updatesUntil ? (
                <p className="text-xs text-muted-foreground">
                  Updates expired on {new Date(updatesUntil).toLocaleDateString()}.
                </p>
              ) : null}
              {entitlementNotice ? (
                <p className="text-xs text-muted-foreground">{entitlementNotice}</p>
              ) : null}
              <Button size="sm" onClick={handleRenewOtl}>
                Renew License
                <ExternalLink className="ml-1.5 h-3 w-3" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
