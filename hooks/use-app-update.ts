"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { markEntitlementRefreshPending } from "@/lib/billing/entitlement-resolver";
import { supabase } from "@/lib/supabase/client";
import { isDesktopRuntime } from "@/lib/desktop";

const DEBUG = true;
function debug(...args: unknown[]) {
  if (DEBUG) console.log("[updater]", ...args);
}

// The Tauri updater endpoint can hang indefinitely on a stalled connection
// (no built-in timeout). Bound every check so the UI never gets stuck on
// "Checking...".
const CHECK_TIMEOUT_MS = 15_000;

export type AppUpdateReturn = ReturnType<typeof useAppUpdate>;

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
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function useAppUpdate() {
  const [updateState, setUpdateState] = useState<AppUpdateState>(DEFAULT_UPDATE_STATE);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;
  const updateRef = useRef<Update | null>(null);
  const mountedRef = useRef(true);

  const checkForUpdates = useCallback(async () => {
    if (!isDesktopRuntime()) return;

    setUpdateState((prev) => ({ ...prev, checking: true, error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      debug("checking for update...");
      const update: Update | null = await withTimeout(
        check(),
        CHECK_TIMEOUT_MS,
        "Update check timed out",
      );
      debug("check result:", update ? `version=${update.version}` : "up to date");
      if (!mountedRef.current) return;

      updateRef.current = update;

      if (update) {
        setUpdateState((prev) => ({
          ...prev,
          enabled: true,
          checking: false,
          updateAvailable: true,
          updateDownloaded: false,
          currentVersion: update.currentVersion,
          latestVersion: update.version,
          releaseDate: update.date ?? null,
        }));
      } else {
        setUpdateState((prev) => {
          const currentVersion = updateRef.current
            ? (updateRef.current as Update).currentVersion
            : prev.currentVersion;
          return {
            ...prev,
            enabled: true,
            checking: false,
            updateAvailable: false,
            currentVersion,
          };
        });
      }
    } catch (e) {
      debug("update check failed:", e);
      if (mountedRef.current) {
        setUpdateState((prev) => ({
          ...prev,
          enabled: true,
          checking: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const getAppVersion = async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        debug("app version:", version);
        if (mountedRef.current) setUpdateState((prev) => ({ ...prev, currentVersion: version }));
      } catch (e) {
        debug("getVersion failed:", e);
      }
    };

    if (isDesktopRuntime()) {
      void getAppVersion();
      void checkForUpdates();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [checkForUpdates]);

  const downloadUpdate = useCallback(async () => {
    if (!isDesktopRuntime()) return false;

    try {
      let update = updateRef.current;
      if (!update) {
        const { check } = await import("@tauri-apps/plugin-updater");
        update = await withTimeout(check(), CHECK_TIMEOUT_MS, "Update check timed out");
        updateRef.current = update;
      }
      if (!update) {
        setUpdateState((prev) => ({ ...prev, updateAvailable: false }));
        return false;
      }

      setUpdateState((prev) => ({
        ...prev,
        downloading: true,
        error: null,
        progressPercent: 0,
      }));

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setUpdateState((prev) => ({ ...prev, progressPercent: 0 }));
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const percent = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : null;
            setUpdateState((prev) => ({ ...prev, progressPercent: percent }));
            break;
          }
          case "Finished":
            setUpdateState((prev) => ({
              ...prev,
              downloading: false,
              updateDownloaded: true,
              progressPercent: 100,
            }));
            break;
        }
      });

      return true;
    } catch (e) {
      debug("download failed:", e);
      setUpdateState((prev) => ({
        ...prev,
        downloading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      return false;
    }
  }, []);

  // Kept as the name consumers already use; performs the download+install step.
  const handleDownload = downloadUpdate;

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    if (!isDesktopRuntime()) {
      setInstalling(false);
      return;
    }
    try {
      if (!updateState.updateDownloaded) {
        const ok = await downloadUpdate();
        if (!ok) {
          setInstalling(false);
          return;
        }
      }
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      debug("install failed:", e);
      setUpdateState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : String(e),
      }));
      setInstalling(false);
    }
  }, [downloadUpdate, updateState.updateDownloaded]);

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
    checkForUpdates,
    handleDownload,
    handleInstall,
    handleDismiss,
    handleRenewOtl,
  };
}
