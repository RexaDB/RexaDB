import { useEffect } from "react";

/**
 * Applies the custom font family to the document root. `ready` should stay
 * `false` until the real persisted value has loaded — every mounted
 * instance of this hook (any Settings view, the studio, etc.) starts from
 * an empty placeholder before its own async load resolves, and applying
 * that placeholder immediately would blank out the font the rest of the
 * app already has applied for a beat (e.g. every time a Settings dialog
 * opens over a page that already set the real font).
 */
export function useAppFontFamily(customFontFamily: string, ready: boolean = true) {
  useEffect(() => {
    if (typeof window === "undefined" || !ready) return;
    const root = document.documentElement;
    const nextValue = customFontFamily.trim();

    if (!nextValue) {
      root.style.removeProperty("--app-font-sans");
      root.removeAttribute("data-custom-font");
      return;
    }

    root.style.setProperty("--app-font-sans", nextValue);
    root.dataset.customFont = "true";

    // No cleanup here on purpose: `--app-font-sans` is a single global CSS
    // variable that can have several concurrent consumers (e.g. a Settings
    // dialog mounted over the very page it's styling). An unmounting
    // instance must not blank out a property that another still-mounted
    // instance — or the page underneath it — still wants applied. It only
    // ever changes by a later call applying a new value.
  }, [customFontFamily, ready]);
}
