type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
  process?: { platform?: string; env?: Record<string, string> };
};

function getTauriWindow(): TauriWindow | null {
  if (typeof window === "undefined") return null;
  return window as TauriWindow;
}

export function isDesktopRuntime() {
  const tauriWindow = getTauriWindow();
  return Boolean(
    tauriWindow &&
      (typeof tauriWindow.__TAURI_INTERNALS__ !== "undefined" ||
        typeof tauriWindow.__TAURI_INTERNALS__ !== "undefined")
  );
}

export function isMacDesktopRuntime() {
  if (!isDesktopRuntime()) return false;
  return (
    (typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform)) ||
    getTauriWindow()?.process?.platform === "darwin"
  );
}

export function isLinuxDesktopRuntime() {
  if (!isDesktopRuntime()) return false;
  if (isMacDesktopRuntime()) return false;
  const tauriWindow = getTauriWindow();
  if (tauriWindow?.process?.platform === "linux") return true;
  if (typeof navigator !== "undefined" && /Linux/i.test(navigator.platform)) return true;
  return false;
}

export function isWindowsDesktopRuntime() {
  if (!isDesktopRuntime()) return false;
  if (isMacDesktopRuntime()) return false;
  if (isLinuxDesktopRuntime()) return false;
  return true;
}

export function isWaylandDesktop() {
  if (!isLinuxDesktopRuntime()) return false;
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("wayland") || ua.includes("hyprland") || ua.includes("sway")) return true;
  }
  try {
    if (typeof process !== "undefined" && process.env?.WAYLAND_DISPLAY) return true;
  } catch {}
  try {
    const tauriWindow = getTauriWindow();
    if (tauriWindow?.process?.env?.WAYLAND_DISPLAY) return true;
  } catch {}
  return false;
}

export function isLinuxDesktopCloseOnly() {
  return isLinuxDesktopRuntime();
}

export async function openExternalUrl(url: string) {
  if (typeof window === "undefined") return;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  } catch {
    // Fall back to browser behavior.
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** How the app was installed, which decides how it can be updated. */
export type InstallKind = "nix" | "standalone";

/**
 * The install kind of the running app.
 *
 * A Nix install lives in the read-only store and cannot replace itself, so
 * it updates through the user's flake instead. Anything we cannot read is
 * treated as a regular install, which is the safe default: the updater can
 * always try, and it fails with a message the user can act on.
 */
export async function getInstallKind(): Promise<InstallKind> {
  if (!isDesktopRuntime()) return "standalone";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const kind = await invoke<string>("install_kind");
    return kind === "nix" ? "nix" : "standalone";
  } catch {
    return "standalone";
  }
}
