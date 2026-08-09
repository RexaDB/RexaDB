"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

interface ThemeContextValue {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  resolvedTheme: string | undefined;
  themes: string[];
  systemTheme: string | undefined;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: undefined,
  setTheme: () => {},
  resolvedTheme: undefined,
  themes: ["light", "dark"],
  systemTheme: undefined,
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "theme";
const THEMES = ["light", "dark"];

function getSystemTheme(): string {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(storageKey: string): string | null {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "system" || (stored && THEMES.includes(stored))) return stored;
  } catch {}
  return null;
}

function getInitialTheme(defaultTheme: string, storageKey: string): string {
  if (typeof window === "undefined") return defaultTheme;
  return getStoredTheme(storageKey) ?? defaultTheme;
}

function getDefaultTheme(defaultTheme?: string, enableSystem?: boolean): string {
  return defaultTheme ?? (enableSystem ? "system" : "light");
}

export function ThemeProvider({
  children,
  defaultTheme: rawDefaultTheme,
  storageKey = STORAGE_KEY,
  themes = THEMES,
  enableSystem = true,
  disableTransitionOnChange = false,
  attribute,
  forcedTheme,
  value,
  themeColor,
  enableColorScheme,
  nonce,
}: {
  children: ReactNode;
  defaultTheme?: string;
  storageKey?: string;
  themes?: string[];
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  attribute?: string;
  forcedTheme?: string;
  value?: Record<string, string>;
  themeColor?: string | Record<string, string>;
  enableColorScheme?: boolean;
  nonce?: string;
}) {
  const defaultTheme = getDefaultTheme(rawDefaultTheme, enableSystem);
  const [theme, setThemeState] = useState<string>(() => getInitialTheme(defaultTheme, storageKey));
  const [systemTheme, setSystemTheme] = useState<string>(getSystemTheme);
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  const applyTheme = useCallback((nextTheme: string) => {
    const resolved = nextTheme === "system" ? getSystemTheme() : nextTheme;
    const root = document.documentElement;

    if (disableTransitionOnChange) {
      const css = document.createElement("style");
      css.textContent = "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;transition:none!important}";
      document.head.appendChild(css);
      const cleanup = () => { window.getComputedStyle(document.body); document.head.removeChild(css); };
      requestAnimationFrame(cleanup);
    }

    root.classList.remove(...themes);
    root.classList.add(resolved);
    if (enableColorScheme !== false) root.style.colorScheme = resolved;

    try { localStorage.setItem(storageKey, nextTheme); } catch {}
  }, [disableTransitionOnChange, enableColorScheme, storageKey, themes]);

  useEffect(() => { applyTheme(theme); }, [theme, applyTheme]);

  useEffect(() => {
    if (!enableSystem) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [enableSystem]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== storageKey || !e.newValue) return;
      if (e.newValue === "system" || THEMES.includes(e.newValue)) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, resolvedTheme, themes, systemTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
