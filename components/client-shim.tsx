"use client";

import { useEffect } from "react";

export function ClientShim() {
  useEffect(() => {
    void import("@/lib/api-base").then((mod) => mod.initApiBase()).catch(() => {});
    void import("@/lib/studio/monaco").then((mod) => mod.initMonaco()).catch(() => {});

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F12") {
        void import("@tauri-apps/api/event").then((m) =>
          m.emit("open-devtools", null)
        ).catch(() => {});
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
