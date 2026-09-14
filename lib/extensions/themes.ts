/**
 * Extension color themes — apply CSS variables + persist selection.
 * Monaco theme registration for extension themes happens in the editor via
 * `customEditorThemes`; this module handles the app-surface (CSS vars) side.
 */

const ACTIVE_THEME_KEY = "rexadb.extensions.activeTheme";

export function applyExtensionThemeVariables(
  theme: { id: string; cssVariables?: Record<string, string> },
  extensionId: string,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Remove previously applied extension vars.
  for (const key of Array.from(root.style)) {
    if (key.startsWith("--ext-")) root.style.removeProperty(key);
  }
  for (const [k, v] of Object.entries(theme.cssVariables ?? {})) {
    const name = k.startsWith("--") ? k : `--ext-${k}`;
    root.style.setProperty(name, v);
  }
  root.dataset.extensionTheme = theme.id;
  try {
    localStorage.setItem(ACTIVE_THEME_KEY, JSON.stringify({ extensionId, themeId: theme.id }));
  } catch {
    /* ignore */
  }
}

export function clearExtensionThemeVariables(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of Array.from(root.style)) {
    if (key.startsWith("--ext-")) root.style.removeProperty(key);
  }
  delete root.dataset.extensionTheme;
  try {
    localStorage.removeItem(ACTIVE_THEME_KEY);
  } catch {
    /* ignore */
  }
}

export function getActiveExtensionTheme(): { extensionId: string; themeId: string } | null {
  try {
    const raw = localStorage.getItem(ACTIVE_THEME_KEY);
    return raw ? (JSON.parse(raw) as { extensionId: string; themeId: string }) : null;
  } catch {
    return null;
  }
}
