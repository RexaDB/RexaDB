"use client";

import { X } from "@/lib/icon-theme/lucide-react";
import { useExtensions } from "@/lib/extensions/react";
import { ExtensionWebview } from "./extension-webview";

/**
 * Renders the currently open extension webview panel (VS Code-like
 * `WebviewPanel`) as a floating dialog. Mount once near the studio root.
 */
export function ExtensionPanelHost() {
  const { activePanel, closePanel } = useExtensions();
  if (!activePanel) return null;
  const html =
    activePanel.html ??
    "<html><body style='font-family:sans-serif;padding:16px'>Empty panel</body></html>";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={closePanel}>
      <div
        className="flex h-[70vh] w-[70vw] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <span className="flex-1 truncate text-sm font-medium">{activePanel.title}</span>
          <button
            type="button"
            onClick={closePanel}
            className="flex size-7 items-center justify-center rounded hover:bg-muted"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ExtensionWebview
            viewId={`panel:${activePanel.panelId}`}
            html={html}
            extensionId={activePanel.extensionId}
          />
        </div>
      </div>
    </div>
  );
}
