"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isDesktopRuntime } from "@/lib/desktop";

/**
 * Handles `rexadb open <database-url-or-file-path>` requests from the Rust
 * side: picks up the pending target stashed at launch and subscribes to
 * `open-database` events forwarded by the single-instance plugin while the
 * app runs. No-ops outside the desktop runtime.
 */
export function DesktopOpenHandler() {
  const router = useRouter();
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let cancelled = false;

    const pump = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        while (queueRef.current.length > 0 && !cancelled) {
          const target = queueRef.current.shift() as string;
          const { openDatabaseTarget } = await import("@/lib/desktop-open");
          const result = await openDatabaseTarget(target);
          if (cancelled) return;
          if (result.success && result.id != null) {
            if (result.name) toast.success(`Opened ${result.name}`);
            router.push(`/studio/${result.id}`);
          } else {
            toast.error("Could not open database", {
              description: result.error || "Unknown error",
            });
          }
        }
      } finally {
        busyRef.current = false;
      }
    };

    const enqueue = (target: string) => {
      if (!target || cancelled) return;
      // Opening the same target twice in a row resolves to the same
      // connection — skip exact duplicates already queued.
      if (queueRef.current.includes(target)) return;
      queueRef.current.push(target);
      void pump();
    };

    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        // Subscribe first so requests arriving during boot are caught via
        // the live event; the pending stash covers anything before that.
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlisten = await listen<{ target: string }>("open-database", (event) => {
          const next = event?.payload?.target;
          if (next) {
            enqueue(next);
            // Acknowledge the Rust-side stash so a later reload doesn't
            // reopen the same request. A *different* stashed target is a
            // newer request that arrived alongside — queue it too.
            void import("@tauri-apps/api/core")
              .then(({ invoke }) =>
                invoke<string | null>("get_pending_open_url").then((stale) => {
                  if (stale && stale !== next) enqueue(stale);
                }),
              )
              .catch(() => undefined);
          }
        });
        if (cancelled) {
          unlisten();
          unlisten = null;
          return;
        }
        const { invoke } = await import("@tauri-apps/api/core");
        if (cancelled) return;
        const pending = await invoke<string | null>("get_pending_open_url");
        if (pending && !cancelled) enqueue(pending);
      } catch {
        // Not running inside Tauri (browser) — nothing to do.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [router]);

  return null;
}
