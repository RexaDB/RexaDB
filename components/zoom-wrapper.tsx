"use client";

import { useEffect, type ReactNode } from "react";
import {
  useGlobalStudioSettings,
  ZOOM_UPDATED_EVENT,
} from "@/hooks/use-global-studio-settings";

/** Last applied zoom, mirrored locally so a relaunch starts at it instead of
 *  100% while settings load. The rexa-db- prefix lets "Reset Everything" clear it. */
const ZOOM_CACHE_KEY = "rexa-db-app-zoom";

let appliedZoom: number | null = null;

function isValidZoom(zoom: unknown): zoom is number {
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom >= 25 && zoom <= 500;
}

async function applyZoom(zoom: number) {
  // Re-applying the same factor still makes WebView2 re-layout; skip it.
  if (!isValidZoom(zoom) || zoom === appliedZoom) return;
  appliedZoom = zoom;
  try {
    localStorage.setItem(ZOOM_CACHE_KEY, String(zoom));
  } catch {
    // Storage may be unavailable.
  }
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(zoom / 100);
  } catch {
    // Tauri API not available (e.g. browser dev mode)
  }
}

function readCachedZoom(): number | null {
  try {
    const zoom = Number(localStorage.getItem(ZOOM_CACHE_KEY));
    return isValidZoom(zoom) ? zoom : null;
  } catch {
    return null;
  }
}

export function ZoomWrapper({ children }: { children: ReactNode }) {
  const { appZoom, isLoaded } = useGlobalStudioSettings(false);

  // Start at the last zoom right away; the saved setting confirms it on load.
  useEffect(() => {
    const cached = readCachedZoom();
    if (cached !== null) void applyZoom(cached);
  }, []);

  useEffect(() => {
    if (isLoaded) void applyZoom(appZoom);
  }, [appZoom, isLoaded]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { zoom } = (e as CustomEvent<{ zoom: number }>).detail;
      void applyZoom(zoom);
    };
    window.addEventListener(ZOOM_UPDATED_EVENT, handler);
    return () => window.removeEventListener(ZOOM_UPDATED_EVENT, handler);
  }, []);

  return <>{children}</>;
}
