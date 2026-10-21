"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { markEntitlementRefreshPending } from "@/lib/billing/entitlement-resolver";
import { invokeBackendFunction } from "@/lib/supabase/backend-client";
import {
  getInstallKind,
  isDesktopRuntime,
  isWindowsDesktopRuntime,
  openExternalUrl,
  type InstallKind,
} from "@/lib/desktop";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { isUpdateDismissed, NIX_UPDATE_COMMAND } from "@/lib/app-update";

const DEBUG = true;
function debug(...args: unknown[]) {
  if (DEBUG) console.log("[updater]", ...args);
}

/** Map common Windows install-lock failures to actionable copy. */
function formatUpdaterError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!/permission denied|os error 13|could not rename temporary file/i.test(message)) {
    return message;
  }
  // Only Windows uses Task Manager wording; other platforms keep the raw error.
  const onWindows =
    isWindowsDesktopRuntime() ||
    (typeof navigator !== "undefined" && /Win/i.test((navigator as any).platform || (navigator as any).userAgent || ""));
  if (!onWindows) return message;
  return `${message} Quit every RexaDB window (and check Task Manager for leftover processes), then retry the update.`;
}

// The Tauri updater endpoint can hang indefinitely on a stalled connection
// (no built-in timeout). Bound every check so the UI never gets stuck on
// "Checking...".
const CHECK_TIMEOUT_MS = 15_000;
// The release check reads the GitHub API and falls back to the updater
// manifest, and both requests share one budget on the backend. The frontend
// waits a little longer than that budget, so a slow answer still arrives
// instead of being rejected while the backend is still working.
const RELEASE_CHECK_TIMEOUT_MS = 20_000;

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
  /** How the app was installed, which decides how the update is applied. */
  installKind: InstallKind;
  /** Where the release notes are. */
  releaseUrl: string | null;
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
  installKind: "standalone",
  releaseUrl: null,
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

/** The release information the app backend reports for a Nix install. */
interface LatestReleaseInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
}

export function useAppUpdate() {
  const [updateState, setUpdateState] = useState<AppUpdateState>(DEFAULT_UPDATE_STATE);
  const [installing, setInstalling] = useState(false);
  // The dismissed version, so the notice stays hidden until a newer release
  // shows up instead of coming back on every launch.
  const [dismissedVersion, setDismissedVersion] = useLocalStorage<string | null>(
    "rexa-db-dismissed-update",
    null,
  );
  const dismissed = isUpdateDismissed(dismissedVersion, updateState.latestVersion);
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;
  const updateRef = useRef<Update | null>(null);
  const mountedRef = useRef(true);

  const checkForUpdates = useCallback(async () => {
    if (!isDesktopRuntime()) return;

    setUpdateState((prev) => ({ ...prev, checking: true, error: null }));
    try {
      const installKind = await getInstallKind();
      if (!mountedRef.current) return;
      // Save it right away: the update instructions must stay available even
      // when the release feed cannot be reached.
      setUpdateState((prev) => ({ ...prev, installKind }));

      // A Nix install cannot replace its own binary, and the Nix build has
      // no updater plugin to ask — so the release is checked directly.
      if (installKind === "nix") {
        debug("nix install: checking the release feed...");
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await withTimeout(
          invoke<LatestReleaseInfo>("latest_release_info"),
          RELEASE_CHECK_TIMEOUT_MS,
          "Update check timed out",
        );
        debug("nix release:", info.latestVersion ?? "unknown");
        if (!mountedRef.current) return;
        setUpdateState((prev) => ({
          ...prev,
          enabled: true,
          checking: false,
          updateAvailable: info.updateAvailable,
          updateDownloaded: false,
          currentVersion: info.currentVersion || prev.currentVersion,
          latestVersion: info.latestVersion,
          releaseDate: info.publishedAt,
          releaseUrl: info.releaseUrl,
        }));
        return;
      }

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

  /**
   * Copy a Nix update command.
   *
   * A Nix install cannot replace its own binary, so there is nothing to
   * download: the command that updates it is copied instead.
   */
  const copyNixCommand = useCallback(
    async (command: string, description?: string) => {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (!clipboard) {
        toast.error("Could not copy the update command.");
        return;
      }
      try {
        await clipboard.writeText(command);
        toast.success(`Copied "${command}"`, description ? { description } : undefined);
      } catch {
        toast.error("Could not copy the update command.");
      }
    },
    [],
  );

  /**
   * The action behind the update notice. The command that is copied is the
   * one for a configuration flake; the other ways of installing are named in
   * the toast and listed in the settings.
   */
  const applyNixUpdate = useCallback(async () => {
    await copyNixCommand(
      NIX_UPDATE_COMMAND,
      "Then rebuild your configuration. Installed as a profile? Run `nix profile upgrade` instead.",
    );
  }, [copyNixCommand]);

  const downloadUpdate = useCallback(async () => {
    if (!isDesktopRuntime()) return false;

    if (updateState.installKind === "nix") {
      await applyNixUpdate();
      return true;
    }

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
        error: formatUpdaterError(e),
      }));
      return false;
    }
  }, [updateState.installKind, applyNixUpdate]);

  // Kept as the name consumers already use; performs the download+install step.
  const handleDownload = downloadUpdate;

  const handleInstall = useCallback(async () => {
    if (updateState.installKind === "nix") {
      await applyNixUpdate();
      return;
    }
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
        error: formatUpdaterError(e),
      }));
      setInstalling(false);
    }
  }, [downloadUpdate, updateState.updateDownloaded, updateState.installKind, applyNixUpdate]);

  const handleDismiss = useCallback(() => {
    setDismissedVersion(updateState.latestVersion);
  }, [setDismissedVersion, updateState.latestVersion]);

  // Kept as the setter consumers already use: dismissing hides the notice
  // for the version that is on screen, and a newer release brings it back.
  const setDismissed = useCallback(
    (value: boolean) => {
      setDismissedVersion(value ? updateState.latestVersion : null);
    },
    [setDismissedVersion, updateState.latestVersion],
  );

  const handleRenewOtl = useCallback(async () => {
    const { data, error } = await invokeBackendFunction("subscribe", {
      planCode: "otl",
    });
    if (error || data?.error) return;
    if (data?.checkoutUrl) {
      markEntitlementRefreshPending();
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
    copyNixCommand,
  };
}
