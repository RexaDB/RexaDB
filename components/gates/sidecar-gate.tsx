"use client";

import { useEffect, useState, useRef } from "react";
import { AppBootSkeleton } from "@/components/gates/app-boot-skeleton";

// The Rust side's own health-check fallback (src-tauri/src/lib.rs spawn_sidecar)
// can take up to ~65s in the worst case (5s initial wait + 30 retries * 2s) to
// confirm the sidecar is actually listening, e.g. on a slow first-launch cargo
// compile. This gate used to give up after a fixed 20s and render the app
// anyway *without* ever calling initApiBase() - permanently stuck on the
// hardcoded default port (3867) for the whole session, silently talking to
// whatever (wrong) thing happens to be on that port instead of the real
// sidecar. Poll comfortably past the Rust-side worst case, and keep
// resyncing in the background afterward in case the sidecar restarts (it
// respawns automatically on crash, possibly on a different port).
const GIVE_UP_AFTER_MS = 90_000;
const BACKGROUND_RESYNC_INTERVAL_MS = 5_000;

export function SidecarGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const called = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const ok = await invoke<boolean>("is_sidecar_ready");
        if (cancelled) return;
        if (ok) {
          await import("@/lib/api-base").then((m) => m.initApiBase());
          if (!cancelled) setReady(true);
          return;
        }
      } catch {
        // Not running inside Tauri (plain browser) - nothing to discover.
        if (!cancelled) setReady(true);
        return;
      }
      timer = setTimeout(poll, 500);
    }

    if (!called.current) {
      called.current = true;
      poll();
    }

    const fallback = setTimeout(async () => {
      if (cancelled) return;
      console.warn("[SidecarGate] fallback timeout reached, proceeding without confirmed sidecar readiness");
      // Best-effort: grab whatever port Rust currently has on file, even
      // though we couldn't confirm readiness - better than staying on the
      // hardcoded default.
      await import("@/lib/api-base").then((m) => m.initApiBase()).catch(() => {});
      if (!cancelled) setReady(true);
    }, GIVE_UP_AFTER_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, []);

  // Once past the gate, keep resyncing the API base in the background so a
  // sidecar crash-and-respawn (possibly on a new port) doesn't leave the app
  // stuck talking to a dead port for the rest of the session.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const ok = await invoke<boolean>("is_sidecar_ready");
        if (!cancelled && ok) {
          await import("@/lib/api-base").then((m) => m.initApiBase());
        }
      } catch {
        // not running inside Tauri - nothing to resync
      }
    }, BACKGROUND_RESYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ready]);

  if (ready) return <>{children}</>;

  return <AppBootSkeleton />;
}
