"use client";

import { useExtensions } from "@/lib/extensions/react";
import { ExtensionWebview } from "./extension-webview";

/**
 * Editor-tab host for extension panels (`rexa.window.openWebviewPanel`
 * with `area: "editor"`).
 *
 * Tab content is the PANEL's own html (declared in the manifest or passed at
 * runtime) — never sidebar content. Each panel gets its own tab, so an
 * extension can have many tabs open next to its single sidebar.
 */
export function ExtensionPanelTabView({
  panelId,
  html,
}: {
  panelId: string;
  html?: string;
}) {
  const { panels } = useExtensions();
  const panel = panels.find((p) => p.panelId === panelId);
  if (!panel && !html) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Extension panel “{panelId}” is not available (extension disabled or uninstalled).
      </div>
    );
  }
  const resolved =
    html ??
    panel?.html ??
    "<html><body style='font-family:sans-serif;padding:16px'>Empty panel</body></html>";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExtensionWebview
        viewId={`tab:panel:${panelId}`}
        html={resolved}
        extensionId={panel?.extensionId}
      />
    </div>
  );
}
