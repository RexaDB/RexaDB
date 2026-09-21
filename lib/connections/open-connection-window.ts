import { LogicalPosition } from "@tauri-apps/api/dpi";

/**
 * Open a connection's studio in a new window.
 * - Tauri desktop: dedicated WebviewWindow (same styling as the Agents window).
 * - Browser: window.open() with noopener.
 */
export async function openConnectionInNewWindow(
  connectionId: number,
): Promise<void> {
  const url = `/studio/${connectionId}`;
  const label = `studio-${connectionId}`;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(label).catch(() => null);
    if (existing) {
      try {
        await existing.setFocus();
        return;
      } catch {
        /* fall through and open a fresh window */
      }
    }
    new WebviewWindow(label, {
      url,
      title: "RexaDB",
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      transparent: true,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      trafficLightPosition: new LogicalPosition(14, 21),
      decorations: true,
      center: true,
      resizable: true,
      skipTaskbar: false,
    });
    return;
  } catch {
    /* Not in Tauri — fall back to a browser tab below. */
  }

  window.open(url, `_blank_${label}`, "noopener,noreferrer");
}
