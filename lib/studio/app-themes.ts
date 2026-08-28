export type CustomAppTheme = {
  id: string;
  name: string;
  base: "light" | "dark";
  colors: Record<string, string>;
};

export const BUILTIN_APP_THEMES: CustomAppTheme[] = [
  {
    id: "zinc-dark-white",
    name: "Zinc Dark White",
    base: "dark",
    colors: {
      "--background": "#151515",
      "--ai-chat-bg": "#171718",
      "--shell-content-bg": "var(--studio-bg)",
      "--shell-tab-active-bg": "var(--studio-tab-active)",
      "--shell-tab-inactive-bg": "var(--studio-tab-inactive)",
      "--shell-history-bg": "var(--studio-bg)",
      "--foreground": "#fafafa",
      "--card": "#18181b",
      "--card-foreground": "#fafafa",
      "--popover": "#18181b",
      "--popover-foreground": "#fafafa",
      "--primary": "#ffffff",
      "--primary-foreground": "#18181b",
      "--secondary": "#27272a",
      "--secondary-foreground": "#fafafa",
      "--muted": "#27272a",
      "--muted-foreground": "#a1a1aa",
      "--accent": "#27272a",
      "--accent-foreground": "#fafafa",
      "--destructive": "#f87171",
      "--border": "#202023",
      "--input": "rgba(255,255,255,0.15)",
      "--ring": "#ffffff",
      "--chart-1": "#ffffff",
      "--chart-2": "#e4e4e7",
      "--chart-3": "#a1a1aa",
      "--chart-4": "#71717a",
      "--chart-5": "#52525b",
      "--sidebar": "#070707",
      "--sidebar-foreground": "#fafafa",
      "--sidebar-primary": "#ffffff",
      "--sidebar-primary-foreground": "#18181b",
      "--sidebar-accent": "#27272a",
      "--sidebar-accent-foreground": "#fafafa",
      "--sidebar-border": "#202023",
      "--sidebar-ring": "#ffffff",
      "--studio-bg": "#090a0b",
      "--studio-border": "#24282e",
      "--studio-header-bg": "#050505",
      "--table-header-bg": "#17191c",
      "--studio-cell-text": "#e4e4e7",
      "--studio-cell-muted": "#71717a",
      "--studio-tab-active": "#141414",
      "--studio-tab-inactive": "#0a0a0a",
      "--studio-row-hover": "#17191c",
      "--studio-selection": "rgba(255,255,255,0.15)",
      "--studio-accent-purple": "#7c3aed",
    },
  },
  {
    id: "void-blue",
    name: "Void Blue",
    base: "dark",
    colors: {
      "--background": "#000000",
      "--foreground": "oklch(0.985 0 0)",
      "--card": "#0A0A0A",
      "--card-foreground": "oklch(0.985 0 0)",
      "--popover": "#0F0F0F",
      "--popover-foreground": "oklch(0.985 0 0)",
      "--primary": "#2563EB",
      "--primary-foreground": "#FFFFFF",
      "--secondary": "#1A1A1A",
      "--secondary-foreground": "oklch(0.985 0 0)",
      "--muted": "#1A1A1A",
      "--muted-foreground": "#71717A",
      "--accent": "#1A1A1A",
      "--accent-foreground": "oklch(0.985 0 0)",
      "--destructive": "oklch(0.704 0.191 22.216)",
      "--border": "#1A1A1A",
      "--input": "#1A1A1A",
      "--ring": "#2563EB",
      "--chart-1": "oklch(0.488 0.243 264.376)",
      "--chart-2": "oklch(0.696 0.17 162.48)",
      "--chart-3": "oklch(0.769 0.188 70.08)",
      "--chart-4": "oklch(0.627 0.265 303.9)",
      "--chart-5": "oklch(0.645 0.246 16.439)",
      "--sidebar": "#0A0A0A",
      "--sidebar-foreground": "oklch(0.985 0 0)",
      "--sidebar-primary": "#2563EB",
      "--sidebar-primary-foreground": "#FFFFFF",
      "--sidebar-accent": "#1A1A1A",
      "--sidebar-accent-foreground": "oklch(0.985 0 0)",
      "--sidebar-border": "#1A1A1A",
      "--sidebar-ring": "#2563EB",
      "--studio-bg": "#090a0b",
      "--studio-border": "#24282e",
      "--studio-header-bg": "#050505",
      "--table-header-bg": "#17191c",
      "--studio-cell-text": "#E4E4E7",
      "--studio-cell-muted": "#71717A",
      "--studio-tab-active": "#141414",
      "--studio-tab-inactive": "#0A0A0A",
      "--studio-row-hover": "#17191c",
      "--studio-selection": "rgba(37, 99, 235, 0.28)",
      "--studio-accent-purple": "#7c3aed",
    },
  },
];

type AppThemeInput = {
  name?: string;
  type?: "light" | "dark";
  base?: "light" | "dark";
  colors?: Record<string, string>;
  variables?: Record<string, string>;
};

export function parseAppThemeJson(themeJson: string): {
  theme?: Omit<CustomAppTheme, "id">;
  error?: string;
} {
  let parsed: AppThemeInput | null = null;
  try {
    parsed = JSON.parse(themeJson) as AppThemeInput;
  } catch {
    return { error: "Theme JSON is not valid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "Theme JSON must be an object." };
  }

  const base = parsed.base || parsed.type;
  if (base !== "light" && base !== "dark") {
    return { error: "Theme JSON must include a 'type' or 'base' of 'light' or 'dark'." };
  }

  const rawColors = parsed.colors || parsed.variables;
  if (!rawColors || typeof rawColors !== "object") {
    return { error: "Theme JSON must include a 'colors' object." };
  }

  const colors: Record<string, string> = {};
  Object.entries(rawColors).forEach(([key, value]) => {
    if (!value) return;
    const name = key.startsWith("--") ? key : `--${key}`;
    colors[name] = String(value);
  });

  if (Object.keys(colors).length === 0) {
    return { error: "Theme JSON colors must contain at least one CSS variable." };
  }

  return {
    theme: {
      name: typeof parsed.name === "string" ? parsed.name.trim() || "Custom Theme" : "Custom Theme",
      base,
      colors,
    },
  };
}

export function applyAppThemeVariables(
  root: HTMLElement,
  colors: Record<string, string>,
  previousKeys: string[]
) {
  previousKeys.forEach((key) => root.style.removeProperty(key));
  const appliedKeys: string[] = [];
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
    appliedKeys.push(key);
  });
  return appliedKeys;
}
