"use client";

import { useState, useEffect, useCallback } from "react";
import { isDesktopRuntime, isMacDesktopRuntime, isWindowsDesktopRuntime, isWaylandDesktop, isLinuxDesktopCloseOnly } from "@/lib/desktop";

export function useDesktopWindow() {
  const [isMaximized, setIsMaximized] = useState(false);
  // Hydration-safe: SSR renders with `false` (matching `isDesktopRuntime()`
  // returning false when `window` is undefined), and the real values are
  // resolved in an effect after mount. Computing `isDesktopRuntime()` during
  // render would return `true` on the first client render inside Tauri while
  // the server rendered `false`, causing a hydration mismatch.
  const [canUseDesktop, setCanUseDesktop] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [isWayland, setIsWayland] = useState(false);
  const [isLinuxCloseOnly, setIsLinuxCloseOnly] = useState(false);

  useEffect(() => {
    setCanUseDesktop(isDesktopRuntime());
    setIsMac(isMacDesktopRuntime());
    setIsWindows(isWindowsDesktopRuntime());
    setIsWayland(isWaylandDesktop());
    setIsLinuxCloseOnly(isLinuxDesktopCloseOnly());
  }, []);

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
