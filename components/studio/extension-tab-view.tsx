"use client";

import { useExtensions } from "@/lib/extensions/react";
import { ExtensionWebview } from "./extension-webview";

/**
 * Editor-tab host for extension views (`rexa.window.openTab(viewId)`).
 * Content resolves live from the extension registry so tabs never persist
 * stale HTML — if the extension is gone, a placeholder renders.
 */
export function ExtensionTabView({ viewId }: { viewId: string }) {
  const { views, webviewHtml } = useExtensions();
  const view = views.find((v) => v.viewId === viewId);
  if (!view) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Extension view “{viewId}” is not available (extension disabled or uninstalled).
      </div>
    );
  }
  if (view.type !== "webview") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        View “{view.name}” is a tree view — it lives in the sidebar, not in tabs.
      </div>
    );
  }
  const html =
    webviewHtml[viewId] ??
    view.html ??
    "<html><body style='font-family:sans-serif;padding:16px'>Empty view</body></html>";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExtensionWebview viewId={`tab:${viewId}`} html={html} extensionId={view.extensionId} />
    </div>
  );
}
