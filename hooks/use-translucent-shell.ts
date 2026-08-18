"use client";

import { useEffect } from "react";
import { isDesktopRuntime } from "@/lib/desktop";

const KEEPALIVE_ID = "translucent-frost-keepalive";

function ensureKeepaliveNode() {
  let node = document.getElementById(KEEPALIVE_ID);
  if (!node) {
    node = document.createElement("div");
    node.id = KEEPALIVE_ID;
    node.setAttribute("aria-hidden", "true");
    document.body.appendChild(node);
  }
  return node;
}

function removeKeepaliveNode() {
  document.getElementById(KEEPALIVE_ID)?.remove();
}

function clearShellStyles() {
  document.documentElement.classList.remove("translucent-shell-active");
  document.documentElement.style.removeProperty("--sidebar");
  document.documentElement.style.removeProperty("--sidebar-backdrop");
  document.body.style.removeProperty("background");
  removeKeepaliveNode();
  if (isDesktopRuntime()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().clearEffects())
      .catch(() => {});
  }
}

/**
 * macOS vibrancy / frosted chrome for translucent mode.
 *
 * Do not animate or transform the backdrop-filter node itself — that makes
 * WebKit sample an empty backdrop and the window looks fully transparent.
 * Native effects are applied once (and again on focus/visibility). A 1px
 * dummy layer is animated separately so idle compositor freezes are less
 * likely without destroying the frost.
 */
export function useTranslucentShell(enabled?: boolean) {
  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];

    if (!enabled) {
      clearShellStyles();
      return;
    }

    document.documentElement.classList.add("translucent-shell-active");
    document.documentElement.style.setProperty("--sidebar", "transparent", "important");
    document.documentElement.style.setProperty(
      "--sidebar-backdrop",
      "blur(24px) saturate(180%)",
      "important",
    );
    document.body.style.setProperty(
      "background",
      "rgba(16, 16, 16, 0.72)",
      "important",
    );
    ensureKeepaliveNode();

    if (!isDesktopRuntime()) {
      document.body.style.setProperty(
        "background",
        "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        "important",
      );
      return () => {
        active = false;
        clearShellStyles();
      };
    }

    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow, Effect, EffectState }) => {
        if (!active) return;
        const win = getCurrentWindow();

        const applyFrost = async (focused = true) => {
          if (!active) return;
          try {
            await win.setEffects({
              effects: [Effect.Sidebar],
              state: EffectState.Active,
            });
          } catch {
            /* ignore */
          }
          if (!active) return;
          document.body.style.setProperty(
            "background",
            focused ? "rgba(16, 16, 16, 0.72)" : "rgba(16, 16, 16, 0.86)",
            "important",
          );
        };

        await applyFrost(true);

        try {
          const unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
            void applyFrost(Boolean(focused));
          });
          cleanups.push(unlistenFocus);
        } catch {
          /* ignore */
        }

        const onVis = () => {
          if (document.visibilityState === "visible") {
            void applyFrost(document.hasFocus());
          }
        };
        document.addEventListener("visibilitychange", onVis);
        cleanups.push(() => document.removeEventListener("visibilitychange", onVis));
      })
      .catch(() => {});

    return () => {
      active = false;
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
      clearShellStyles();
    };
  }, [enabled]);
}
