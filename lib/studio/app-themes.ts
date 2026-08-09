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
      "--shell-content-bg": "#0F0F10",
      "--shell-tab-active-bg": "#1C1D1F",
      "--shell-tab-inactive-bg": "#131416",
      "--shell-history-bg": "#1B1B1C",
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
    id: "midnight-contrast",
    name: "Midnight Contrast",
    base: "dark",
    colors: {
      "--background": "#050505",
      "--foreground": "#f5f5f5",
      "--card": "#0b0b0b",
      "--card-foreground": "#f5f5f5",
      "--popover": "#0b0b0b",
      "--popover-foreground": "#f5f5f5",
      "--primary": "#7dd3fc",
      "--primary-foreground": "#050505",
      "--secondary": "#0f0f0f",
      "--secondary-foreground": "#f5f5f5",
      "--muted": "#0f0f0f",
      "--muted-foreground": "#9ca3af",
      "--accent": "#111827",
      "--accent-foreground": "#f5f5f5",
      "--destructive": "#ef4444",
      "--border": "#1f2937",
      "--input": "#111827",
      "--ring": "#7dd3fc",
      "--sidebar": "#050505",
      "--sidebar-foreground": "#f5f5f5",
      "--sidebar-primary": "#7dd3fc",
      "--sidebar-primary-foreground": "#050505",
      "--sidebar-accent": "#111827",
      "--sidebar-accent-foreground": "#f5f5f5",
      "--sidebar-border": "#1f2937",
      "--sidebar-ring": "#7dd3fc",
      "--studio-bg": "#050505",
      "--studio-border": "#1f2937",
      "--studio-header-bg": "#0b0b0b",
      "--table-header-bg": "#0f0f0f",
      "--studio-cell-text": "#f5f5f5",
      "--studio-cell-muted": "#9ca3af",
      "--studio-tab-active": "#0b0b0b",
      "--studio-tab-inactive": "#050505",
      "--studio-row-hover": "#0f0f0f",
      "--studio-selection": "rgba(125, 211, 252, 0.2)",
      "--studio-accent-purple": "#a855f7",
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
  {
    id: "void-yellow",
    name: "Void Yellow",
    base: "dark",
    colors: {
      "--background": "#0c0d0d",
      "--foreground": "#f6f3ea",
      "--card": "#121414",
      "--card-foreground": "#f6f3ea",
      "--popover": "#141616",
      "--popover-foreground": "#f6f3ea",
      "--primary": "#f3dc72",
      "--primary-foreground": "#0c0d0d",
      "--secondary": "#1a1c1b",
      "--secondary-foreground": "#f6f3ea",
      "--muted": "#1a1c1b",
      "--muted-foreground": "rgba(246, 243, 234, 0.6)",
      "--accent": "#202222",
      "--accent-foreground": "#f6f3ea",
      "--destructive": "#e45858",
      "--border": "rgba(255, 255, 255, 0.12)",
      "--input": "rgba(255, 255, 255, 0.12)",
      "--ring": "rgba(243, 220, 114, 0.4)",
      "--chart-1": "oklch(0.809 0.105 251.813)",
      "--chart-2": "oklch(0.623 0.214 259.815)",
      "--chart-3": "oklch(0.546 0.245 262.881)",
      "--chart-4": "oklch(0.488 0.243 264.376)",
      "--chart-5": "oklch(0.424 0.199 265.638)",
      "--sidebar": "#101112",
      "--sidebar-foreground": "#f6f3ea",
      "--sidebar-primary": "#f3dc72",
      "--sidebar-primary-foreground": "#0c0d0d",
      "--sidebar-accent": "#202222",
      "--sidebar-accent-foreground": "#f6f3ea",
      "--sidebar-border": "rgba(255, 255, 255, 0.12)",
      "--sidebar-ring": "rgba(243, 220, 114, 0.4)",
      "--studio-bg": "#090a0b",
      "--studio-border": "#24282e",
      "--studio-header-bg": "#050505",
      "--table-header-bg": "#17191c",
      "--studio-cell-text": "#E4E4E7",
      "--studio-cell-muted": "#71717A",
      "--studio-tab-active": "#141414",
      "--studio-tab-inactive": "#0A0A0A",
      "--studio-row-hover": "#17191c",
      "--studio-selection": "rgba(124, 58, 237, 0.15)",
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
