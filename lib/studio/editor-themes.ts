export type CustomEditorTheme = {
  id: string;
  name: string;
  themeJson: string;
};

export type MonacoThemeRule = {
  token?: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
};

export type MonacoThemeDefinition = {
  base: "vs" | "vs-dark" | "hc-black" | "hc-light";
  inherit?: boolean;
  rules?: MonacoThemeRule[];
  colors?: Record<string, string>;
};

export type MonacoThemeRef = {
  id: string;
  theme: MonacoThemeDefinition;
};

type VsCodeThemeInput = {
  name?: string;
  type?: "light" | "dark" | "hc";
  colors?: Record<string, string>;
  tokenColors?: Array<{
    scope?: string | string[];
    settings?: {
      foreground?: string;
      background?: string;
      fontStyle?: string;
    };
  }>;
  rules?: MonacoThemeRule[];
  base?: MonacoThemeDefinition["base"];
  inherit?: boolean;
};

const VALID_BASES: Array<MonacoThemeDefinition["base"]> = ["vs", "vs-dark", "hc-black", "hc-light"];

/**
 * Convert any CSS color string to `#RRGGBB` or `#RRGGBBAA` format for Monaco themes.
 * Handles: #RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba(), and named colors.
 * Returns the input unchanged if it can't be parsed (best-effort).
 */
export function parseCssColor(value: string): string {
  const trimmed = value.trim();

  // Already hex — normalize
  const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      // #RGB → #RRGGBB
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (hex.length === 4) {
      // #RGBA → #RRGGBBAA
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex}`;
    }
  }

  // rgb() or rgba()
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (rgbaMatch) {
    const r = Math.round(Math.min(255, Math.max(0, Number(rgbaMatch[1]))));
    const g = Math.round(Math.min(255, Math.max(0, Number(rgbaMatch[2]))));
    const b = Math.round(Math.min(255, Math.max(0, Number(rgbaMatch[3]))));
    const a = rgbaMatch[4] != null ? Math.min(1, Math.max(0, Number(rgbaMatch[4]))) : 1;
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    const hex = `${toHex(r)}${toHex(g)}${toHex(b)}`;
    if (a >= 1) return `#${hex}`;
    return `#${hex}${toHex(Math.round(a * 255))}`;
  }

  // Fallback — return as-is (best-effort)
  return trimmed;
}

const toScopeList = (scope: unknown): string[] => {
  if (Array.isArray(scope)) {
    return scope.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof scope === "string") {
    return scope
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const inferBase = (input: VsCodeThemeInput): MonacoThemeDefinition["base"] => {
  if (input.base && VALID_BASES.includes(input.base)) return input.base;
  if (input.type === "dark") return "vs-dark";
  if (input.type === "light") return "vs";
  if (input.type === "hc") return "hc-black";
  return "vs-dark";
};

export function parseThemeJson(themeJson: string): {
  theme?: MonacoThemeDefinition;
  name?: string;
  error?: string;
} {
  let parsed: VsCodeThemeInput | null = null;
  try {
    parsed = JSON.parse(themeJson) as VsCodeThemeInput;
  } catch (err) {
    return { error: "Theme JSON is not valid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "Theme JSON must be an object." };
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : undefined;

  if (Array.isArray(parsed.rules) || parsed.base) {
    return {
      name,
      theme: {
        base: inferBase(parsed),
        inherit: typeof parsed.inherit === "boolean" ? parsed.inherit : true,
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        colors: typeof parsed.colors === "object" && parsed.colors ? parsed.colors : {},
      },
    };
  }

  if (!parsed.tokenColors && !parsed.colors) {
    return { error: "Theme JSON must include either 'rules' (Monaco) or 'tokenColors'/'colors' (VS Code)." };
  }

  const rules: MonacoThemeRule[] = [];
  if (Array.isArray(parsed.tokenColors)) {
    parsed.tokenColors.forEach((entry) => {
      const scopes = toScopeList(entry.scope);
      if (!scopes.length) return;
      const settings = entry.settings || {};
      const ruleBase: MonacoThemeRule = {
        foreground: settings.foreground,
        background: settings.background,
        fontStyle: settings.fontStyle,
      };
      scopes.forEach((scope) => {
        rules.push({ token: scope, ...ruleBase });
      });
    });
  }

  return {
    name,
    theme: {
      base: inferBase(parsed),
      inherit: true,
      rules,
      colors: typeof parsed.colors === "object" && parsed.colors ? parsed.colors : {},
    },
  };
}

export function resolveEditorThemeId(
  selection: string | null | undefined,
  appTheme: string | undefined,
  appEditorThemeId?: string | null
): string {
  if (!selection || selection === "auto") {
    if (appEditorThemeId) return appEditorThemeId;
    return appTheme === "dark" ? "studio-dark" : "light";
  }
  return selection;
}

export function createThemeId(name: string, existingIds: Set<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "") || "custom-theme";
  if (!existingIds.has(base)) return base;
  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

export function createThemeNameFromId(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function registerCustomMonacoThemes(
  monaco: any,
  themes: Array<{ id: string; theme: MonacoThemeDefinition | undefined }>
) {
  if (!monaco?.editor?.defineTheme) return;
  themes.forEach((theme) => {
    if (!theme.theme) return;
    try {
      monaco.editor.defineTheme(theme.id, theme.theme);
    } catch {
      // Theme already defined or monaco disposed
    }
  });
}

export function getStudioDarkTheme(): MonacoThemeDefinition {
  const get = (key: string, fallback: string) => {
    if (typeof document === "undefined") return parseCssColor(fallback);
    const raw = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
    return parseCssColor(raw || fallback);
  };
  const selection = get("--studio-selection", "rgba(91, 141, 239, 0.22)");
  return {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": get("--studio-bg", "#111111"),
      "editor.foreground": get("--studio-cell-text", "#e2e2e2"),
      "editor.lineHighlightBackground": get("--studio-row-hover", "#202020"),
      "editorGutter.background": get("--studio-bg", "#111111"),
      "editor.selectionBackground": selection,
      "editor.inactiveSelectionBackground": selection,
      "editor.selectionHighlightBackground": selection,
      "editor.wordHighlightBackground": selection,
      "editor.wordHighlightStrongBackground": selection,
      "editorCursor.foreground": get("--studio-cell-text", "#e2e2e2"),
      "editorLineNumber.foreground": get("--studio-cell-muted", "#9d9d9d"),
      "editorLineNumber.activeForeground": get("--studio-cell-text", "#e2e2e2"),
      "editorIndentGuide.background": get("--studio-border", "#2a2a2a"),
      "editorIndentGuide.activeBackground": get("--studio-border", "#2a2a2a"),
      "editorBracketMatch.background": selection,
      "editorBracketMatch.border": get("--studio-border", "#2a2a2a"),
    },
  };
}

export function buildMonacoThemeFromAppTheme(appTheme: {
  base: "light" | "dark";
  colors: Record<string, string>;
}): MonacoThemeDefinition {
  const pick = (key: string, fallback: string) =>
    appTheme.colors[key] || fallback;
  const toMonacoColor = (value: string | undefined, fallback: string) => {
    // Monaco rules[].foreground expects hex WITHOUT # prefix
    const hex = parseCssColor(value || fallback);
    return hex.startsWith("#") ? hex.slice(1) : hex;
  };

  const background = parseCssColor(pick("--studio-bg", pick("--background", "#111111")));
  const foreground = parseCssColor(pick("--studio-cell-text", pick("--foreground", "#e2e2e2")));
  const muted = parseCssColor(pick("--studio-cell-muted", pick("--muted-foreground", "#9d9d9d")));
  const lineHighlight = parseCssColor(pick("--studio-row-hover", pick("--muted", "#202020")));
  const selection = parseCssColor(pick("--studio-selection", "rgba(91, 141, 239, 0.22)"));
  const border = parseCssColor(pick("--studio-border", pick("--border", "#2a2a2a")));

  // Prefer extracted syntax tokens, fall back to chart colors, then to hardcoded
  const keyword = parseCssColor(pick("--syntax-keyword", pick("--chart-4", pick("--primary", "#60a5fa"))));
  const string = parseCssColor(pick("--syntax-string", pick("--chart-2", "#8bd5ca")));
  const number = parseCssColor(pick("--syntax-number", pick("--chart-3", "#f59e0b")));
  const functionColor = parseCssColor(pick("--syntax-function", pick("--chart-1", pick("--chart-4", "#a78bfa"))));
  const variable = parseCssColor(pick("--syntax-variable", pick("--chart-5", "#f472b6")));
  return {
    base: appTheme.base === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: toMonacoColor(muted, "#9ca3af") },
      { token: "string", foreground: toMonacoColor(string, "#8bd5ca") },
      { token: "string.sql", foreground: toMonacoColor(string, "#8bd5ca") },
      { token: "number", foreground: toMonacoColor(number, "#f59e0b") },
      { token: "keyword", foreground: toMonacoColor(keyword, "#60a5fa"), fontStyle: "bold" },
      { token: "keyword.sql", foreground: toMonacoColor(keyword, "#60a5fa"), fontStyle: "bold" },
      { token: "operator", foreground: toMonacoColor(foreground, "#e2e2e2") },
      { token: "delimiter", foreground: toMonacoColor(foreground, "#e2e2e2") },
      { token: "type", foreground: toMonacoColor(functionColor, "#a78bfa") },
      { token: "function", foreground: toMonacoColor(functionColor, "#a78bfa") },
      { token: "identifier", foreground: toMonacoColor(foreground, "#e2e2e2") },
      { token: "variable", foreground: toMonacoColor(variable, "#f472b6") },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editor.lineHighlightBackground": lineHighlight,
      "editor.selectionBackground": selection,
      "editor.inactiveSelectionBackground": selection,
      "editor.selectionHighlightBackground": selection,
      "editor.wordHighlightBackground": selection,
      "editor.wordHighlightStrongBackground": selection,
      "editor.findMatchBackground": selection,
      "editor.findMatchHighlightBackground": selection,
      "editor.findRangeHighlightBackground": selection,
      "editor.rangeHighlightBackground": selection,
      "editorGutter.background": background,
      "editorGutter.foreground": muted,
      "editorLineNumber.foreground": muted,
      "editorLineNumber.activeForeground": foreground,
      "editorCursor.foreground": foreground,
      "editorIndentGuide.background": border,
      "editorIndentGuide.activeBackground": border,
      "editorBracketMatch.background": selection,
      "editorBracketMatch.border": border,
      "editorWhitespace.foreground": border,
    },
  };
}
