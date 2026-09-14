"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Puzzle } from "@/lib/icon-theme/lucide-react";
import { useExtensions } from "@/lib/extensions/react";
import { ExtensionView } from "./extension-tree-view";
import { ExtensionWebview } from "./extension-webview";
import { cn } from "@/lib/utils";

/**
 * Standalone container sidebar (`extensions:<containerId>` rail target).
 *
 * Free-form surface: when the extension provides a sidebar page (manifest
 * `viewsContainers[].html` or runtime `rexa.window.registerSidebarPage`),
 * it fills the sidebar — whatever the extension wants it to be
 * (explorer-like, dashboard-like). Otherwise the container's declared views
 * render as a fallback list. Never linked to the Extensions manager sidebar.
 */
export function ExtensionSidebarSection({
  studio,
  activeContainer,
}: {
  studio?: { openExtensionsTab?: () => void };
  /** When set (rail target `extensions:<containerId>`), show only this container's views. */
  activeContainer?: string;
}) {
  const { views, containers, openTab, sidebarHtml } = useExtensions();
  const [openViews, setOpenViews] = useState<Record<string, boolean>>({});

  const standaloneViews = useMemo(
    () => views.filter((view) => view.containerId === activeContainer),
    [views, activeContainer],
  );

  const groups = useMemo(() => {
    const containerTitles = new Map(containers.map((c) => [c.containerId, c.title]));
    const byGroup = new Map<string, typeof views>();
    for (const view of views) {
      const title = (view.containerId && containerTitles.get(view.containerId)) || view.containerTitle || "Extensions";
      if (!byGroup.has(title)) byGroup.set(title, []);
      byGroup.get(title)!.push(view);
    }
    return [...byGroup.entries()];
  }, [views, containers]);

  const openManagerTab = () => studio?.openExtensionsTab?.();

  // Standalone container sidebar: a free-form page when the extension
  // provides one (whatever it wants it to be — explorer-like,
  // dashboard-like), otherwise the declared views list as fallback.
  if (activeContainer) {
    const pageHtml = sidebarHtml[activeContainer];
    if (pageHtml) {
      const owner = containers.find((c) => c.containerId === activeContainer)?.extensionId;
      // h-full (not flex-1): the parent section container has definite height
      // but is not a flex parent, so flex-1 is inert and the iframe's h-full
      // would collapse. h-full resolves against the definite parent height
      // and the page fills the sidebar; taller content scrolls in the parent.
      return (
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <div className="min-h-0 min-w-0 flex-1">
            <ExtensionWebview
              viewId={`sidebar:${activeContainer}`}
              html={pageHtml}
              extensionId={owner}
            />
          </div>
        </div>
      );
    }
    if (standaloneViews.length === 0) {
      return (
        <div className="flex flex-col gap-2 p-2">
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No views in this container.
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {standaloneViews.map((view) => {
            const open = openViews[view.viewId] ?? true;
            return (
              <div key={view.viewId}>
                <div className="group flex h-8 w-full items-center gap-1 px-2">
                  <button
                    type="button"
                    onClick={() => setOpenViews((p) => ({ ...p, [view.viewId]: !open }))}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={cn("size-3 shrink-0 transition-transform", !open && "-rotate-90")} />
                    <span className="truncate">{view.name}</span>
                  </button>
                  {view.type === "webview" && (
                    <button
                      type="button"
                      title={`Open ${view.name} in a tab`}
                      onClick={() => openTab(view.viewId)}
                      className="hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground group-hover:flex"
                    >
                      <ExternalLink className="size-3" />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="min-h-16 pb-1">
                    <ExtensionView viewId={view.viewId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (views.length === 0 || groups.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          {views.length === 0 ? "No extension views yet." : "No views in this container."}
        </div>
        <button
          type="button"
          onClick={openManagerTab}
          className="flex h-8 items-center justify-center gap-2 rounded-lg border text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <Puzzle className="size-3.5" /> Manage extensions
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([groupTitle, groupViews]) => (
          <div key={groupTitle} className="border-b border-border/50 pb-1 last:border-0">
            <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {groupTitle}
            </div>
            {groupViews.map((view) => {
              const open = openViews[view.viewId] ?? true;
              return (
                <div key={view.viewId}>
                  <div className="group flex h-8 w-full items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => setOpenViews((p) => ({ ...p, [view.viewId]: !open }))}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={cn("size-3 shrink-0 transition-transform", !open && "-rotate-90")} />
                      <span className="truncate">{view.name}</span>
                    </button>
                    {view.type === "webview" && (
                      <button
                        type="button"
                        title={`Open ${view.name} in a tab`}
                        onClick={() => openTab(view.viewId)}
                        className="hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground group-hover:flex"
                      >
                        <ExternalLink className="size-3" />
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="min-h-16 pb-1">
                      <ExtensionView viewId={view.viewId} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={openManagerTab}
        className="flex h-8 shrink-0 items-center justify-center gap-2 border-t text-xs text-muted-foreground hover:text-foreground"
      >
        <Puzzle className="size-3.5" /> Manage extensions
      </button>
    </div>
  );
}
