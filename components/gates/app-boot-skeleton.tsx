"use client";

import { useLayoutEffect, useState } from "react";
import { DEFAULT_LAYOUT_PREFS, readCachedLayoutPrefs } from "@/lib/studio/layout-prefs-cache";

// Static placeholder chrome shown while the app is still booting (waiting on
// the Tauri sidecar). Mirrors the real AppShell / ModernUIShell scaffolding —
// just the sidebar and content cards, empty — so the very first paint already
// looks like "the app" in the user's selected layout and theme, instead of a
// bare spinner on a blank screen. Reads the layout preference synchronously
// from the same localStorage cache `useGlobalStudioSettings` warms (see
// hooks/use-global-studio-settings.ts and lib/studio/layout-prefs-cache.ts),
// so it picks the right skeleton even before that hook's own state has
// mounted anywhere.

// Matches the real content-panel-surface / content card (app-shell.tsx,
// modern-ui-shell.tsx): border-border + --shell-content-bg.
const contentCardClass = "rounded-lg border border-border bg-[var(--shell-content-bg)]";
// Classic AppShell's sidebar (components/ui/sidebar.tsx's plain
// "sidebar-inner"): bg-sidebar, no border — a different shade from the
// content card in every theme (see BUILTIN_APP_THEMES in
// lib/studio/app-themes.ts, --sidebar vs --studio-bg), so it must NOT share
// contentCardClass.
const newLayoutSidebarCardClass = "rounded-lg bg-sidebar";
// Modern UI's sidebar is explicitly re-skinned to match the content card
// (see the `[&_[data-slot=sidebar-inner]]:bg-[var(--shell-content-bg)]` /
// `:border-border` overrides in modern-ui-shell.tsx's <AppSidebar> — it
// sits inside a bg-sidebar rail/gutter row, not directly on it), so it
// reuses contentCardClass rather than the New Layout sidebar's plain style.

function ModernUiBootSkeleton() {
  return (
    <div className="relative flex h-dvh w-dvw min-w-0 flex-col overflow-hidden bg-sidebar">
      {/* Floating title bar strip. */}
      <div className="absolute inset-x-0 top-0 z-10 h-9 shrink-0" />
      <div className="flex min-h-0 min-w-0 flex-1 bg-sidebar">
        {/* Always-visible rail. */}
        <div className="h-full w-12 shrink-0 bg-sidebar" />
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Sidebar card. */}
          <div className={`mt-9 ml-1.5 h-[calc(100%-2.25rem)] w-64 shrink-0 ${contentCardClass}`} />
          {/* Content card. Right margin matches modern-ui-shell.tsx's
              SidebarInset (md:peer-data-[variant=inset]:m-2, with only
              ml/mt/mb zeroed out — mr is left intact). */}
          <div className={`mt-9 mr-2 ml-1.5 h-[calc(100%-2.25rem)] min-w-0 flex-1 ${contentCardClass}`} />
        </div>
      </div>
      {/* Status bar strip. */}
      <div className="h-6 shrink-0 bg-sidebar" />
    </div>
  );
}

function NewLayoutBootSkeleton() {
  return (
    <div className="flex h-dvh w-dvw min-w-0 bg-sidebar p-1">
      {/* Sidebar card. */}
      <div className={`h-full w-64 shrink-0 ${newLayoutSidebarCardClass}`} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Tab strip. */}
        <div className="h-9 shrink-0" />
        {/* Content card. */}
        <div className={`mx-2 min-h-0 flex-1 ${contentCardClass}`} />
        {/* Reserved bottom strip. */}
        <div className="h-8 shrink-0" />
      </div>
    </div>
  );
}

export function AppBootSkeleton() {
  // Mounted by SidecarGate, which is genuinely part of the server-rendered /
  // hydration-compared tree — so the very first render (server HTML, and the
  // client's initial hydration pass) must be identical, or React throws a
  // hydration mismatch. It can't read localStorage yet and has to use the
  // same fixed defaults as the server. `useLayoutEffect` only ever runs
  // client-side, and only after that first pass has already committed, so
  // reading the real cached value there is hydration-safe; running it
  // synchronously (vs. `useEffect`) means the correction lands before the
  // browser paints, so there's no visible flash either.
  const [layout, setLayout] = useState(DEFAULT_LAYOUT_PREFS);

  useLayoutEffect(() => {
    setLayout(readCachedLayoutPrefs());
  }, []);

  if (layout.modernUiLayout) return <ModernUiBootSkeleton />;
  if (layout.appShellLayout) return <NewLayoutBootSkeleton />;
  return <div className="h-dvh w-dvw bg-sidebar" />;
}
