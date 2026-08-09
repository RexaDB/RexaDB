"use client";

import { useEffect, type ReactNode } from "react";
import {
  useGlobalStudioSettings,
  ZOOM_UPDATED_EVENT,
} from "@/hooks/use-global-studio-settings";

async function applyZoom(zoom: number) {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(zoom / 100);
  } catch {
    // Tauri API not available (e.g. browser dev mode)
  }
}

export function ZoomWrapper({ children }: { children: ReactNode }) {
  const { appZoom } = useGlobalStudioSettings(false);

  useEffect(() => {
    applyZoom(appZoom);
  }, [appZoom]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { zoom } = (e as CustomEvent<{ zoom: number }>).detail;
      applyZoom(zoom);
    };
    window.addEventListener(ZOOM_UPDATED_EVENT, handler);
    return () => window.removeEventListener(ZOOM_UPDATED_EVENT, handler);
  }, []);

  return <>{children}</>;
}
