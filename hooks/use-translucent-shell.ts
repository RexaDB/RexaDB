"use client";

import { useEffect } from "react";
import { isDesktopRuntime } from "@/lib/desktop";

function clearShellStyles() {
  document.documentElement.style.removeProperty("--sidebar");
  document.documentElement.style.removeProperty("--sidebar-backdrop");
  document.body.style.removeProperty("background");
  if (isDesktopRuntime()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().clearEffects())
      .catch(() => {});
  }
}

export function useTranslucentShell(enabled?: boolean) {
  useEffect(() => {
    let unlistenFocus: (() => void) | undefined;
    let active = true;

    if (enabled) {
      if (isDesktopRuntime()) {
        import("@tauri-apps/api/window")
          .then(async ({ getCurrentWindow, Effect, EffectState }) => {
            const win = getCurrentWindow();
            await win.setEffects({ effects: [Effect.Sidebar], state: EffectState.Active });
            const unlisten = await win.onFocusChanged(({ payload: focused }) => {
              if (focused) {
                document.body.style.setProperty("background", "rgba(16, 16, 16, 0.72)", "important");
                win.setEffects({ effects: [Effect.Sidebar], state: EffectState.Active }).catch(() => {});
              } else {
                document.body.style.setProperty("background", "rgb(16, 16, 16)", "important");
              }
            });
            if (active) {
              unlistenFocus = unlisten;
            } else {
              unlisten();
            }
          })
          .catch(() => {});

        document.documentElement.style.setProperty("--sidebar", "transparent", "important");
        document.documentElement.style.setProperty("--sidebar-backdrop", "blur(24px) saturate(180%)", "important");
        document.body.style.setProperty("background", "rgba(16, 16, 16, 0.72)", "important");
      } else {
        document.documentElement.style.removeProperty("--sidebar");
        document.body.style.setProperty(
          "background",
          "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          "important",
        );
      }

      return () => {
        active = false;
        unlistenFocus?.();
        clearShellStyles();
      };
    } else {
      clearShellStyles();
    }
  }, [enabled]);
}
