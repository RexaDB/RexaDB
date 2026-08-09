"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  DEFAULT_ICON_THEME_ID,
  ICON_THEME_UPDATED_EVENT,
  normalizeCustomIconThemes,
  type CustomIconTheme,
} from "@/lib/icon-theme/types";

interface IconThemeState {
  iconThemeId: string;
  customIconThemes: CustomIconTheme[];
}

const IconThemeContext = createContext<IconThemeState>({
  iconThemeId: DEFAULT_ICON_THEME_ID,
  customIconThemes: [],
});

function readInitialIconTheme(): IconThemeState {
  if (typeof window === "undefined") {
    return { iconThemeId: DEFAULT_ICON_THEME_ID, customIconThemes: [] };
  }

  const el = document.getElementById("rexadb-initial-appearance") as HTMLTemplateElement | null;
  const raw = el?.textContent || "{}";
  let initialAppearance: Record<string, unknown> = {};
  try { initialAppearance = JSON.parse(raw); } catch { initialAppearance = {}; }

  return {
    iconThemeId:
      typeof initialAppearance?.iconThemeId === "string" && initialAppearance.iconThemeId.trim()
        ? initialAppearance.iconThemeId
        : DEFAULT_ICON_THEME_ID,
    customIconThemes: normalizeCustomIconThemes(initialAppearance?.customIconThemes),
  };
}

export function IconThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IconThemeState>(readInitialIconTheme);

  useEffect(() => {
    const handleThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<IconThemeState>).detail;
      setState({
        iconThemeId:
          typeof detail?.iconThemeId === "string" && detail.iconThemeId.trim()
            ? detail.iconThemeId
            : DEFAULT_ICON_THEME_ID,
        customIconThemes: normalizeCustomIconThemes(detail?.customIconThemes),
      });
    };

    window.addEventListener(ICON_THEME_UPDATED_EVENT, handleThemeUpdated as EventListener);
    return () => window.removeEventListener(ICON_THEME_UPDATED_EVENT, handleThemeUpdated as EventListener);
  }, []);

  const value = useMemo(() => state, [state]);
  return <IconThemeContext.Provider value={value}>{children}</IconThemeContext.Provider>;
}

export function useIconTheme() {
  return useContext(IconThemeContext);
}

