"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/providers/theme-provider";

import { readInitialAppearance } from "@/lib/studio/general-utils";
import { saveGlobalAppThemeSettings, getGlobalAppThemeSettings } from "@/lib/api/actions-client";
import { applyAppThemeVariables, BUILTIN_APP_THEMES, type CustomAppTheme } from "@/lib/studio/app-themes";
import { buildMonacoThemeFromAppTheme, type MonacoThemeRef } from "@/lib/studio/editor-themes";

const ALL_THEME_VAR_KEYS = [
  "--background", "--shell-content-bg", "--shell-tab-active-bg", "--shell-tab-inactive-bg",
  "--shell-history-bg",
  "--foreground", "--card", "--card-foreground",
  "--popover", "--popover-foreground", "--primary", "--primary-foreground",
  "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
  "--accent", "--accent-foreground", "--destructive", "--border", "--input",
  "--ring", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5",
  "--sidebar", "--sidebar-foreground", "--sidebar-primary",
  "--sidebar-primary-foreground", "--sidebar-accent", "--sidebar-accent-foreground",
  "--sidebar-border", "--sidebar-ring", "--studio-bg", "--studio-border",
  "--studio-header-bg", "--table-header-bg", "--studio-cell-text",
  "--studio-cell-muted", "--studio-tab-active", "--studio-tab-inactive",
  "--studio-row-hover", "--studio-selection", "--studio-accent-purple",
  // Shell chrome
  "--title-bar-bg", "--title-bar-fg",
  "--activity-bar-bg", "--activity-bar-fg", "--activity-bar-inactive",
  "--activity-bar-active-border",
  "--side-bar-bg", "--side-bar-fg", "--side-bar-header-bg",
  "--panel-bg", "--panel-fg", "--panel-border", "--panel-header-bg",
  "--status-bar-bg", "--status-bar-fg",
  "--shell-bg", "--shell-fg", "--shell-fg-muted", "--shell-border",
  "--shell-chip", "--shell-chip-hover", "--shell-chip-active",
  "--shell-sidebar", "--shell-panel",
  // Tabs
  "--tab-active-bg", "--tab-active-fg",
  "--tab-inactive-bg", "--tab-inactive-fg",
  "--tab-hover-bg", "--tab-border", "--tab-active-border-top",
  // Editor widgets / overlays
  "--editor-widget-bg", "--editor-widget-fg", "--editor-widget-border",
  "--menu-bg", "--menu-fg", "--menu-separator",
  "--notification-bg", "--notification-fg", "--notification-border",
  // Controls
  "--button-bg", "--button-fg", "--button-hover-bg",
  "--badge-bg", "--badge-fg",
  "--input-bg", "--input-fg", "--input-border", "--input-placeholder",
  "--progress-bar-bg",
  // Scrollbar
  "--scrollbar-bg", "--scrollbar-hover-bg", "--scrollbar-active-bg",
  // Lists
  "--list-hover-bg", "--list-hover-fg",
  "--list-active-bg", "--list-active-fg",
  "--list-focus-bg", "--list-focus-fg",
  // Editor groups
  "--editor-group-bg", "--editor-group-border",
  "--editor-group-tabs-bg", "--editor-group-tabs-border",
  // Syntax tokens
  "--syntax-keyword", "--syntax-string", "--syntax-number",
  "--syntax-function", "--syntax-variable", "--syntax-comment", "--syntax-type",
];

const DEFAULT_DARK_THEME_ID = "zinc-dark-white";

// The resolved theme CSS variables only get applied to `document.documentElement`
// from a `useEffect` here, once this hook has mounted and (often) loaded the
// real settings asynchronously — so every boot starts on the default theme
// and visibly switches to the user's real theme a moment later. Caching the
// last-applied variables lets the blocking inline script in app/layout.tsx's
// <head> (which already does this for plain light/dark) apply them before
// the very first paint instead.
const APP_THEME_VARS_STORAGE_KEY = "rexa-db-app-theme-vars";

function getSystemColorScheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readInitialThemeAppearance() {
  const parsed = readInitialAppearance();
  return {
    appThemeId: typeof parsed?.appThemeId === "string" ? parsed.appThemeId : DEFAULT_DARK_THEME_ID,
    customAppThemes: Array.isArray(parsed?.customAppThemes) ? parsed.customAppThemes as CustomAppTheme[] : [],
  };
}

function resolveSystemTheme(
  systemColorScheme: "light" | "dark",
  customAppThemes: CustomAppTheme[],
): CustomAppTheme | null {
  if (systemColorScheme === "dark") {
    return customAppThemes.find((t) => t.id === DEFAULT_DARK_THEME_ID) ||
      BUILTIN_APP_THEMES.find((t) => t.id === DEFAULT_DARK_THEME_ID) ||
      null;
  }
  return null;
}

export function useGlobalAppTheme(persist = false) {
  const { setTheme } = useTheme();
  const [appThemeId, setAppThemeId] = useState<string>(() => readInitialThemeAppearance().appThemeId);
  const [customAppThemes, setCustomAppThemes] = useState<CustomAppTheme[]>(() => readInitialThemeAppearance().customAppThemes);
  const [isLoaded, setIsLoaded] = useState(false);
  const [systemColorScheme, setSystemColorScheme] = useState<"light" | "dark">(getSystemColorScheme);
  const appliedThemeVarsRef = useRef<string[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemColorScheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const selectedAppTheme = useMemo(() => {
    if (appThemeId === "system") {
      return resolveSystemTheme(systemColorScheme, customAppThemes);
    }
    return (
      customAppThemes.find((theme) => theme.id === appThemeId) ||
      BUILTIN_APP_THEMES.find((theme) => theme.id === appThemeId) ||
      null
    );
  }, [appThemeId, customAppThemes, systemColorScheme]);

  const appEditorTheme: MonacoThemeRef | null = useMemo(() => {
    if (!selectedAppTheme) return null;
    return {
      id: `app-${selectedAppTheme.id}`,
      theme: buildMonacoThemeFromAppTheme(selectedAppTheme),
    };
  }, [selectedAppTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const load = async () => {
      let result: Awaited<ReturnType<typeof getGlobalAppThemeSettings>> | null = null;
      try {
        result = await getGlobalAppThemeSettings();
      } catch {
        result = null;
      }
      if (cancelled) return;
      // `isLoaded` must be set regardless of whether saved data was found —
      // it's what gates the color-applying effect below. Returning early
      // without setting it (the previous behavior here) left `isLoaded`
      // permanently false for anyone without an explicitly saved theme
      // (the common case), which now means NO theme colors ever get applied
      // — a completely unstyled app, not just a fallback to the default.
      const hasData = !!result && result.success && (
        (typeof result.data?.appThemeId === "string" && result.data.appThemeId) ||
        (typeof result.data?.customAppThemes === "string" && result.data.customAppThemes !== "[]")
      );
      if (hasData && result) {
        const nextAppThemeId = typeof result.data?.appThemeId === "string"
          ? result.data.appThemeId || DEFAULT_DARK_THEME_ID
          : DEFAULT_DARK_THEME_ID;
        let nextCustomThemes: CustomAppTheme[] = [];
        if (typeof result.data?.customAppThemes === "string") {
          try {
            const parsed = JSON.parse(result.data.customAppThemes);
            if (Array.isArray(parsed)) {
              nextCustomThemes = parsed.filter((theme) =>
                theme &&
                typeof theme.id === "string" &&
                typeof theme.name === "string" &&
                (theme.base === "light" || theme.base === "dark") &&
                typeof theme.colors === "object"
              );
            }
          } catch {
            nextCustomThemes = [];
          }
        }
        setAppThemeId(nextAppThemeId);
        setCustomAppThemes(nextCustomThemes);
      }
      setIsLoaded(true);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // `appThemeId`/`customAppThemes` start from readInitialThemeAppearance(),
    // which currently always resolves to the hardcoded defaults (nothing
    // populates the #rexadb-initial-appearance template it reads) — so
    // `selectedAppTheme` is the *default* theme, not the user's real one,
    // until the async load below resolves. Applying it before `isLoaded`
    // would stomp over the correct colors the boot script in app/layout.tsx
    // already applied from the localStorage cache, causing a visible flash
    // to the wrong (default) theme on every mount.
    if (!isLoaded) return;
    const root = document.documentElement;
    if (!selectedAppTheme) {
      appliedThemeVarsRef.current.forEach((key) => root.style.removeProperty(key));
      appliedThemeVarsRef.current = [];
      ALL_THEME_VAR_KEYS.forEach((key) => root.style.removeProperty(key));
      root.removeAttribute("data-app-theme");
      root.style.removeProperty("color-scheme");
      if (appThemeId === "light") {
        setTheme("light");
      } else if (appThemeId === "dark") {
        setTheme("dark");
      } else if (appThemeId === "system") {
        setTheme(systemColorScheme);
      }
      return;
    }

    appliedThemeVarsRef.current = applyAppThemeVariables(
      root,
      selectedAppTheme.colors,
      appliedThemeVarsRef.current
    );
    root.dataset.appTheme = selectedAppTheme.id;
    root.style.colorScheme = selectedAppTheme.base;
    setTheme(selectedAppTheme.base);
  }, [appThemeId, isLoaded, selectedAppTheme, setTheme, systemColorScheme]);

  useEffect(() => {
    if (typeof window === "undefined" || !isLoaded) return;
    try {
      if (selectedAppTheme) {
        window.localStorage.setItem(
          APP_THEME_VARS_STORAGE_KEY,
          JSON.stringify({
            id: selectedAppTheme.id,
            base: selectedAppTheme.base,
            colors: selectedAppTheme.colors,
          }),
        );
      } else {
        window.localStorage.removeItem(APP_THEME_VARS_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [selectedAppTheme, isLoaded]);

  useEffect(() => {
    if (!persist || !isLoaded) return;
    void saveGlobalAppThemeSettings({
      appThemeId,
      customAppThemes: JSON.stringify(customAppThemes),
    });
  }, [appThemeId, customAppThemes, isLoaded, persist]);

  return {
    appThemeId,
    setAppThemeId,
    customAppThemes,
    setCustomAppThemes,
    selectedAppTheme,
    appEditorTheme,
    isLoaded,
  };
}
