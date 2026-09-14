/**
 * Where an extension webview panel opens.
 *
 * Sidebar views (`contributes.views`) are sidebar content. Editor tabs are a
 * separate surface backed by `contributes.webviewPanels`: a panel declared
 * with `area: "editor"` opens as a full-height editor tab (each panel its own
 * tab, so extensions can have many), anything else opens as a floating
 * dialog. `openTab(viewId)` remains as a sidebar-view pop-out only.
 */
export type ExtensionPanelTarget = "tab" | "dialog";

export function resolvePanelTarget(area?: string): ExtensionPanelTarget {
  return area === "editor" ? "tab" : "dialog";
}
