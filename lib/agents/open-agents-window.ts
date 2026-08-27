import { LogicalPosition } from "@tauri-apps/api/dpi";

/**
 * Open the Agents panel in a dedicated Tauri window.
 * Matches the main RexaDB window styling and size.
 * Falls back to window.open() when not running inside Tauri.
 */
export async function openAgentsWindow(connectionId: number): Promise<void> {
  const label = `agents-${connectionId}`;

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      try {
        await existing.close();
      } catch {}
    }

    new WebviewWindow(label, {
      url: `/studio/${connectionId}/agents`,
      title: "RexaDB — Agents",
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
  } catch {
    window.open(`/studio/${connectionId}/agents`, `_blank_${label}`);
  }
}
