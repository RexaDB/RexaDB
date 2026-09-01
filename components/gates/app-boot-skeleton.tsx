"use client";

// Static placeholder chrome shown while the app is still booting (waiting on
// the Tauri sidecar). Mirrors the real ModernUIShell scaffolding — just the
// sidebar and content cards, empty — so the very first paint already looks
// like "the app" instead of a bare spinner on a blank screen.

// Matches the real content-panel-surface / content card (modern-ui-shell.tsx):
// border-border + --shell-content-bg.
const contentCardClass = "rounded-lg border border-border bg-[var(--shell-content-bg)]";

export function AppBootSkeleton() {
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
