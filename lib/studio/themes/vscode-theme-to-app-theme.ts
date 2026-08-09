import {
  pickColor,
  lighten,
  darken,
  saturate,
  desaturate,
  hueRotate,
  alpha,
  contrastForeground,
  isValidColor,
} from "@/lib/studio/themes/color-utils";
import { MAPPINGS, type MappingEntry } from "@/lib/studio/themes/theme-mappings";

type SyntaxCategory =
  | "keyword" | "string" | "number" | "function"
  | "variable" | "comment" | "type";

const SYNTAX_PATTERNS: Array<{ pattern: string; var: `--syntax-${SyntaxCategory}` }> = [
  { pattern: "keyword.control", var: "--syntax-keyword" },
  { pattern: "keyword", var: "--syntax-keyword" },
  { pattern: "storage.type", var: "--syntax-keyword" },
  { pattern: "storage.modifier", var: "--syntax-keyword" },
  { pattern: "string.quoted", var: "--syntax-string" },
  { pattern: "string.template", var: "--syntax-string" },
  { pattern: "string", var: "--syntax-string" },
  { pattern: "constant.numeric", var: "--syntax-number" },
  { pattern: "constant.language", var: "--syntax-keyword" },
  { pattern: "constant.character", var: "--syntax-string" },
  { pattern: "entity.name.function", var: "--syntax-function" },
  { pattern: "support.function", var: "--syntax-function" },
  { pattern: "entity.name.method", var: "--syntax-function" },
  { pattern: "variable.other", var: "--syntax-variable" },
  { pattern: "variable.parameter", var: "--syntax-variable" },
  { pattern: "variable", var: "--syntax-variable" },
  { pattern: "comment.line", var: "--syntax-comment" },
  { pattern: "comment.block", var: "--syntax-comment" },
  { pattern: "comment", var: "--syntax-comment" },
  { pattern: "entity.name.type", var: "--syntax-type" },
  { pattern: "support.type", var: "--syntax-type" },
  { pattern: "entity.other.inherited-class", var: "--syntax-type" },
];

function matchesScopePattern(scope: string, pattern: string): boolean {
  return scope === pattern || scope.startsWith(pattern + ".");
}

function extractSyntaxColors(
  tokenColors: Array<{ scope?: string | string[]; settings?: { foreground?: string } }> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(tokenColors)) return result;

  for (const entry of tokenColors) {
    const fg = entry.settings?.foreground;
    if (!fg || !isValidColor(fg)) continue;

    const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope || ""];
    for (const scope of scopes) {
      const trimmed = scope.trim();
      if (!trimmed) continue;

      for (const { pattern, var: varName } of SYNTAX_PATTERNS) {
        if (result[varName]) continue;
        if (matchesScopePattern(trimmed, pattern)) {
          result[varName] = fg;
        }
      }
    }
  }
  return result;
}

function applyDerive(
  entry: MappingEntry,
  resolved: Record<string, string>,
  base: "light" | "dark",
): string {
  if (!entry.derive) return entry.fallback;
  const source = resolved[entry.derive.from];
  if (!source || !isValidColor(source)) return entry.fallback;

  const { op, amount } = entry.derive;
  switch (op) {
    case "lighten": return lighten(source, amount ?? 5);
    case "darken": return darken(source, amount ?? 5);
    case "saturate": return saturate(source, amount ?? 0.03);
    case "desaturate": return desaturate(source, amount ?? 0.03);
    case "hue-rotate": return hueRotate(source, amount ?? 30);
    case "alpha": return alpha(source, amount ?? 0.15);
    case "contrast-fg": return contrastForeground(source);
  }
}

function generateChartColors(
  primary: string,
  syntaxColors: Record<string, string>,
): Record<string, string> {
  const chartVars: Array<{ key: string; syntaxVar: string; hueOffset: number }> = [
    { key: "--chart-1", syntaxVar: "--syntax-function", hueOffset: 0 },
    { key: "--chart-2", syntaxVar: "--syntax-string", hueOffset: 60 },
    { key: "--chart-3", syntaxVar: "--syntax-number", hueOffset: 120 },
    { key: "--chart-4", syntaxVar: "--syntax-keyword", hueOffset: 180 },
    { key: "--chart-5", syntaxVar: "--syntax-variable", hueOffset: 240 },
  ];

  const colors: Record<string, string> = {};
  for (const { key, syntaxVar, hueOffset } of chartVars) {
    const syntaxColor = syntaxColors[syntaxVar];
    if (syntaxColor && isValidColor(syntaxColor)) {
      colors[key] = syntaxColor;
    } else if (isValidColor(primary)) {
      colors[key] = hueRotate(primary, hueOffset);
    }
  }
  return colors;
}

export function vsCodeThemeToAppTheme(
  vsCodeJson: Record<string, unknown>,
  base: "light" | "dark" = "dark",
): Record<string, string> {
  const colors = (vsCodeJson.colors as Record<string, string>) || {};
  const tokenColors = vsCodeJson.tokenColors as Array<{
    scope?: string | string[];
    settings?: { foreground?: string };
  }> | undefined;

  const result: Record<string, string> = {};

  // Pass 1: resolve all entries from VS Code colors
  for (const entry of MAPPINGS) {
    if (entry.sources.length > 0) {
      result[entry.cssVar] = pickColor(colors, entry.sources, entry.fallback);
    } else {
      result[entry.cssVar] = entry.fallback;
    }
  }

  // Extract syntax colors from tokenColors
  const syntaxColors = extractSyntaxColors(tokenColors);

  // Override syntax vars if found
  for (const [key, value] of Object.entries(syntaxColors)) {
    result[key] = value;
  }

  // Pass 2: resolve derive entries (only if still at fallback)
  for (const entry of MAPPINGS) {
    if (entry.derive) {
      const current = result[entry.cssVar];
      const isFallback = entry.sources.length === 0 || current === entry.fallback;
      if (isFallback) {
        result[entry.cssVar] = applyDerive(entry, result, base);
      }
    }
  }

  // Derived foregrounds
  const primary = result["--primary"];
  result["--primary-foreground"] = isValidColor(primary)
    ? contrastForeground(primary)
    : base === "dark" ? "#ffffff" : "#000000";
  result["--sidebar-primary-foreground"] = result["--primary-foreground"];

  // Table header: slightly lighter than studio bg
  const studioBg = result["--studio-bg"];
  if (isValidColor(studioBg)) {
    result["--table-header-bg"] = lighten(studioBg, 6);
  } else {
    result["--table-header-bg"] = "#17191c";
  }

  // Chart colors from syntax tokens or derived from primary
  const chartColors = generateChartColors(primary, syntaxColors);
  Object.assign(result, chartColors);

  // Fill missing chart slots
  for (let i = 1; i <= 5; i++) {
    const key = `--chart-${i}`;
    if (!result[key] || !isValidColor(result[key])) {
      result[key] = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"][i - 1];
    }
  }

  return result;
}
