export type CustomAppTheme = {
  id: string;
  name: string;
  base: "light" | "dark";
  colors: Record<string, string>;
};

export const BUILTIN_APP_THEMES: CustomAppTheme[] = [
  {
    id: "rexadb-dark",
    name: "RexaDB dark",
    base: "dark",
    colors: {
      "--background": "#111113",
      "--foreground": "#e2e2e2",
      "--card": "#111113",
      "--card-foreground": "#e2e2e2",
      "--popover": "#111113",
      "--popover-foreground": "#e2e2e2",
      "--primary": "#2870bd",
      "--secondary": "#0C0D0E",
      "--secondary-foreground": "#a0a0a0",
      "--muted": "#272a2d",
      "--muted-foreground": "#696e77",
      "--accent": "#212225",
      "--accent-foreground": "#e2e2e2",
      "--destructive": "#ef4444",
      "--border": "#212225",
      "--input": "#18191b",
      "--ring": "#3b82f6",
      "--sidebar": "#0C0D0E",
      "--sidebar-foreground": "#b0b4ba",
      "--sidebar-primary": "#3b82f6",
      "--sidebar-accent": "#0C0D0E",
      "--sidebar-accent-foreground": "#e2e2e2",
      "--sidebar-border": "#212225",
      "--sidebar-ring": "#3b82f6",
      "--studio-bg": "#111113",
      "--studio-border": "#363a3f",
      "--studio-header-bg": "#0C0D0E",
      "--studio-cell-text": "#e2e2e2",
      "--studio-cell-muted": "#696e77",
      "--studio-tab-active": "#18191b",
      "--studio-tab-inactive": "#0C0D0E",
      "--studio-row-hover": "#272a2d",
      "--studio-selection": "#2e3135",
      "--studio-accent-purple": "#8b5cf6",
      "--title-bar-bg": "#0C0D0E",
      "--title-bar-fg": "#b0b4ba",
      "--activity-bar-bg": "#0C0D0E",
      "--activity-bar-fg": "#b0b4ba",
      "--activity-bar-inactive": "#858585",
      "--activity-bar-active-border": "#ffffff",
      "--side-bar-bg": "#0C0D0E",
      "--side-bar-fg": "#b0b4ba",
      "--side-bar-header-bg": "#0C0D0E",
      "--panel-bg": "#0C0D0E",
      "--panel-fg": "#e2e2e2",
      "--panel-border": "#212225",
      "--panel-header-bg": "#0C0D0E",
      "--status-bar-bg": "#0C0D0E",
      "--status-bar-fg": "#b0b4ba",
      "--shell-bg": "#09090a",
      "--shell-fg": "#f3f3f3",
      "--shell-fg-muted": "#696e77",
      "--shell-border": "#353639",
      "--shell-chip": "#060708",
      "--shell-chip-hover": "#101112",
      "--shell-chip-active": "#010202",
      "--shell-sidebar": "#08090a",
      "--shell-panel": "#0d0d0f",
      "--tab-active-bg": "#18191b",
      "--tab-active-fg": "#e2e2e2",
      "--tab-inactive-bg": "#0C0D0E",
      "--tab-inactive-fg": "#666666",
      "--tab-hover-bg": "#272a2d",
      "--tab-border": "#111113",
      "--tab-active-border-top": "#007acc",
      "--editor-widget-bg": "#111113",
      "--editor-widget-fg": "#e2e2e2",
      "--editor-widget-border": "#363a3f",
      "--menu-bg": "#111113",
      "--menu-fg": "#e2e2e2",
      "--menu-separator": "#212225",
      "--notification-bg": "#111113",
      "--notification-fg": "#e2e2e2",
      "--notification-border": "#2a2a2a",
      "--button-bg": "#2870bd",
      "--button-fg": "#ffffff",
      "--button-hover-bg": "#0658a3",
      "--badge-bg": "#004074",
      "--badge-fg": "#ffffff",
      "--input-bg": "#18191b",
      "--input-fg": "#e2e2e2",
      "--input-border": "#212225",
      "--input-placeholder": "#9d9d9d",
      "--progress-bar-bg": "#2870bd",
      "--scrollbar-bg": "#212225",
      "--scrollbar-hover-bg": "#272a2d",
      "--scrollbar-active-bg": "#2e3135",
      "--list-hover-bg": "#272a2d",
      "--list-hover-fg": "#e2e2e2",
      "--list-active-bg": "#212225",
      "--list-active-fg": "#e2e2e2",
      "--list-focus-bg": "#2e3135",
      "--list-focus-fg": "#e2e2e2",
      "--editor-group-bg": "#111113",
      "--editor-group-border": "#363a3f",
      "--editor-group-tabs-bg": "#0C0D0E",
      "--editor-group-tabs-border": "#363a3f",
      "--syntax-keyword": "#de51a8",
      "--syntax-string": "#ffca16",
      "--syntax-number": "#ffca16",
      "--syntax-function": "#dcdcaa",
      "--syntax-variable": "#edeef0",
      "--syntax-comment": "#777b84",
      "--syntax-type": "#3dd68c",
      "--primary-foreground": "#ffffff",
      "--sidebar-primary-foreground": "#ffffff",
      "--table-header-bg": "#1f1f21",
      "--chart-1": "#2870bd",
      "--chart-2": "#ffca16",
      "--chart-3": "#ffca16",
      "--chart-4": "#de51a8",
      "--chart-5": "#edeef0",
    },
  },
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
