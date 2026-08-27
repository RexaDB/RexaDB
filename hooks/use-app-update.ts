"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { markEntitlementRefreshPending } from "@/lib/billing/entitlement-resolver";
import { supabase } from "@/lib/supabase/client";
import { isDesktopRuntime } from "@/lib/desktop";

const DEBUG = true;
function debug(...args: unknown[]) {
  if (DEBUG) console.log("[updater]", ...args);
}

const IS_LINUX = navigator.platform === "Linux x86_64" || navigator.platform?.includes("Linux");

const GITHUB_LATEST_RELEASE =
  "https://api.github.com/repos/rexadbapp/rexadb-app/releases/latest";

interface ManualUpdateInfo {
  version: string;
  currentVersion: string;
  body: string;
  releaseUrl: string;
}

interface AppUpdateState {
  enabled: boolean;
  checking: boolean;
  downloading: boolean;
  updateAvailable: boolean;
  updateDownloaded: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseDate: string | null;
  progressPercent: number | null;
  error: string | null;
  manualUpdate: ManualUpdateInfo | null;
}

const DEFAULT_UPDATE_STATE: AppUpdateState = {
  enabled: false,
  checking: false,
  downloading: false,
  updateAvailable: false,
  updateDownloaded: false,
  currentVersion: "",
  latestVersion: null,
  releaseDate: null,
  progressPercent: null,
  error: null,
  manualUpdate: null,
};

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split("-")[0].split(".").map((p) => Number.parseInt(p, 10) || 0);
}

function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkLinuxRelease(currentVersion: string): Promise<ManualUpdateInfo | null> {
  const res = await fetch(GITHUB_LATEST_RELEASE, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as {
    tag_name: string;
    body?: string;
    html_url: string;
  };
  const remote = data.tag_name.replace(/^v/, "");
  if (!isNewer(remote, currentVersion)) return null;
  return {
    version: remote,
    currentVersion,
    body: data.body ?? "",
    releaseUrl: data.html_url,
  };
}

export function useAppUpdate() {
  const [updateState, setUpdateState] = useState<AppUpdateState>(DEFAULT_UPDATE_STATE);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let mounted = true;
    let unlisten: (() => void) | null = null;

    const getAppVersion = async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        debug("app version:", version);
        if (mounted) setUpdateState((prev) => ({ ...prev, currentVersion: version }));
      } catch (e) {
        debug("getVersion failed:", e);
      }
    };

    const initUpdater = async () => {
      try {
        if (IS_LINUX) {
          debug("Linux detected — using manual GitHub API fallback");
          setUpdateState((prev) => ({ ...prev, enabled: true }));
          const { getVersion } = await import("@tauri-apps/api/app");
          const version = await getVersion();
          try {
            const info = await checkLinuxRelease(version);
            if (mounted && info) {
              debug("manual update available:", info.version);
              setUpdateState((prev) => ({
                ...prev,
                checking: false,
                updateAvailable: true,
                latestVersion: info.version,
                manualUpdate: info,
              }));
            } else {
              debug("no update available (Linux)");
              if (mounted) setUpdateState((prev) => ({ ...prev, checking: false }));
            }
          } catch (e) {
            debug("Linux release check failed:", e);
            if (mounted) setUpdateState((prev) => ({ ...prev, checking: false, error: String(e) }));
          }
          return;
        }

        const mod = await import("@tauri-apps/plugin-updater");
        const onUpdaterEvent = (mod as any).onUpdaterEvent;

        unlisten = await onUpdaterEvent((event: any) => {
          debug("updater event:", JSON.stringify(event));
          if (!mounted) return;
          switch (event.status) {
            case "IDLE":
              break;
            case "CHECKING":
              setUpdateState((prev) => ({ ...prev, checking: true, error: null }));
              break;
            case "UPDATER_HANDLER":
              break;
            case "ERROR":
              debug("updater ERROR:", event.error);
              setUpdateState((prev) => ({ ...prev, checking: false, downloading: false, error: event.error || "Update error" }));
              break;
            case "PENDING":
              debug("update available:", event.body?.version);
              setUpdateState((prev) => ({
                ...prev,
                checking: false,
                updateAvailable: true,
                latestVersion: event.body?.version || null,
                releaseDate: event.body?.date || null,
              }));
              break;
            case "DOWNLOADING":
              setUpdateState((prev) => ({
                ...prev,
                downloading: true,
                progressPercent: event.data?.progress || null,
              }));
              break;
            case "DOWNLOADED":
              setUpdateState((prev) => ({
                ...prev,
                downloading: false,
                updateDownloaded: true,
                updateAvailable: true,
                progressPercent: 100,
              }));
              break;
          }
        });

        setUpdateState((prev) => ({ ...prev, enabled: true }));
        debug("updater initialized — endpoint: latest.json on rexadb-app");
      } catch (e) {
        debug("updater init failed:", e);
      }
    };

    void getAppVersion();
    void initUpdater();

    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, []);

  const handleDownload = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    if (IS_LINUX) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      debug("checking for update (download)...");
      const update = await check();
      debug("check result:", update ? `version=${update.version}` : "null (no update)");
      if (update) {
        setUpdateState((prev) => ({ ...prev, downloading: true }));
        await update.downloadAndInstall();
      }
    } catch (e) {
      debug("download check failed:", e);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    if (!isDesktopRuntime()) return;
    if (IS_LINUX) { setInstalling(false); return; }
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      debug("checking for update (install)...");
      const update = await check();
      debug("check result:", update ? `version=${update.version}` : "null (no update)");
      if (update) {
        await update.downloadAndInstall();
        const { exit } = await import("@tauri-apps/plugin-process");
        await exit(0);
      }
    } catch (e) {
      debug("install check failed:", e);
      setInstalling(false);
    }
  }, []);

  const handleOpenRelease = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    if (!IS_LINUX) return;
    const manual = updateState.manualUpdate;
    if (!manual) return;
    try {
      const { openExternalUrl } = await import("@/lib/desktop");
      await openExternalUrl(manual.releaseUrl);
    } catch (e) {
      debug("open release failed:", e);
    }
  }, [updateState.manualUpdate]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleRenewOtl = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("subscribe", {
      body: { planCode: "otl" },
    });
    if (error || data?.error) return;
    if (data?.checkoutUrl) {
      markEntitlementRefreshPending();
      const { openExternalUrl } = await import("@/lib/desktop");
      await openExternalUrl(data.checkoutUrl);
    }
  }, []);

  return {
    updateState,
    setUpdateState,
    installing,
    setInstalling,
    dismissed,
    setDismissed,
    dismissedRef,
    handleDownload,
    handleInstall,
    handleOpenRelease,
    handleDismiss,
    handleRenewOtl,
  };
}
