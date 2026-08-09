"use client";

import { useState, useEffect, useCallback } from "react";
import { isDesktopRuntime, isMacDesktopRuntime, isWindowsDesktopRuntime, isWaylandDesktop, isLinuxDesktopCloseOnly } from "@/lib/desktop";

export function useDesktopWindow() {
  const [isMaximized, setIsMaximized] = useState(false);
  const canUseDesktop = isDesktopRuntime();
  const isMac = isMacDesktopRuntime();
  const isWindows = isWindowsDesktopRuntime();
  const isWayland = isWaylandDesktop();
  const isLinuxCloseOnly = isLinuxDesktopCloseOnly();

  useEffect(() => {
    if (!canUseDesktop) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlisten = await win.onResized(() => {
          win.isMaximized().then(setIsMaximized);
        });
        win.isMaximized().then(setIsMaximized);
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [canUseDesktop]);

  const sendWindowAction = useCallback(
    async (action: "minimize" | "maximize-toggle" | "close") => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        switch (action) {
          case "minimize":
            await win.minimize();
            break;
          case "maximize-toggle":
            await win.toggleMaximize();
            break;
          case "close":
            await win.close();
            break;
        }
      } catch {
        /* not in Tauri */
      }
    },
    [],
  );

  return { isMaximized, sendWindowAction, canUseDesktop, isMac, isWindows, isWayland, isLinuxCloseOnly };
}
