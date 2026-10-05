"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isDesktopRuntime } from "@/lib/desktop";

/**
 * Handles `rexadb open <database-url-or-file-path>` requests from the Rust
 * side: drains the pending queue stashed at launch (and by the
 * single-instance plugin while the app runs) and subscribes to
 * `open-database` events for live delivery. No-ops outside the desktop
 * runtime.
 *
 * Delivery is exactly-once: the Rust side keeps a FIFO queue where
 * `get_pending_open_url` pops one request per call, the handler drains it in
 * a loop, and a short-lived seen-set suppresses the duplicate that arrives
 * when a request is both stashed AND emitted.
 */

/** How long a delivered target suppresses identical re-deliveries (ms). */
export const OPEN_DEDUP_TTL_MS = 5000;
/** Upper bound per drain pass so a flooding producer can't starve the pump. */
const MAX_DRAIN_PER_PASS = 25;

export function DesktopOpenHandler() {
  const router = useRouter();
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  /** Recently delivered targets → delivery timestamp. */
  const seenRef = useRef(new Map<string, number>());

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
      const now = Date.now();
      for (const [key, at] of seenRef.current) {
        if (now - at > OPEN_DEDUP_TTL_MS) seenRef.current.delete(key);
      }
      // Same request can arrive via both the stash and the live event, and
      // the pump may already be working through it — deliver once.
      if (queueRef.current.includes(target) || seenRef.current.has(target)) return;
      seenRef.current.set(target, now);
      queueRef.current.push(target);
      void pump();
    };

    /** Pop every stashed request (each `invoke` removes one server-side). */
    const drainPending = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        for (;;) {
          if (cancelled) return;
          let taken = 0;
          for (; taken < MAX_DRAIN_PER_PASS; taken++) {
            if (cancelled) return;
            const next = await invoke<string | null>("get_pending_open_url");
            if (!next) break;
            enqueue(next);
          }
          // A full pass means more may be queued — yield, then go again so
          // nothing stays stranded server-side.
          if (taken < MAX_DRAIN_PER_PASS) break;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch {
        // Not running inside Tauri (browser) — nothing to do.
      }
    };

    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        // Subscribe first so requests arriving during boot are caught via
        // the live event; the drain afterwards covers anything stashed
        // before the subscription completed.
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlisten = await listen<{ target: string }>("open-database", (event) => {
          const next = event?.payload?.target;
          if (next) {
            enqueue(next);
            // The Rust side stashes before emitting, so the same request is
            // usually also queued server-side — drain to acknowledge/remove
            // it (deduped above), and to pick up anything stored alongside.
            void drainPending();
          }
        });
        if (cancelled) {
          unlisten();
          unlisten = null;
          return;
        }
        await drainPending();
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
