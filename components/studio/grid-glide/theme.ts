import { useMemo } from "react";
import type { Theme as GlideTheme } from "@glideapps/glide-data-grid";
import { useTheme as useAppTheme } from "@/components/providers/theme-provider";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { parseCssColor } from "@/lib/studio/editor-themes";

/**
 * CSS custom properties (see app/globals.css) that back the grid's palette.
 * Canvas painting doesn't participate in the CSS cascade, so — unlike the
 * legacy DOM grid, which repaints for free on `.dark` toggle — this hook
 * must be recomputed explicitly whenever the resolved theme or a custom
 * app theme changes, mirroring how `buildMonacoThemeFromAppTheme`
 * (lib/studio/editor-themes.ts) bridges the same CSS-variable system into
 * Monaco's theme model.
 */
function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return fallback;
  const parsed = parseCssColor(raw);
  return parsed || fallback;
}

export function useGlideGridTheme(): Partial<GlideTheme> {
  const { resolvedTheme } = useAppTheme();
  const { appThemeId, customAppThemes } = useGlobalAppTheme();

  return useMemo<Partial<GlideTheme>>(() => {
    const bgCell = readCssVar("--studio-bg", "#ffffff");
    const bgHeader = readCssVar("--table-header-bg", "#f8fafc");
    const borderColor = readCssVar("--studio-border", "#e2e8f0");
    const textDark = readCssVar("--studio-cell-text", "#1e293b");
    const textMedium = readCssVar("--studio-cell-muted", "#94a3b8");
    const rowHover = readCssVar("--studio-row-hover", "#f8fafc");
    // Matches the legacy grid's single-cell selection ring/fill exactly
    // (grid/grid-cell.tsx's `cellSelectionBorder`/`cellSelectionBg`) — this
    // is a fixed blue, distinct from `--studio-accent-purple` (used
    // elsewhere in the app for unrelated UI accents, not cell selection).
    const accentColor = "rgb(78, 129, 238)";
    const selection = "rgba(29, 55, 126, 0.2)";
    const fontFamily = readCssVar(
      "--font-sans",
      "Outfit, -apple-system, sans-serif",
    );

    return {
      accentColor,
      accentLight: selection,
      textDark,
      textMedium,
      textLight: textMedium,
      bgCell,
      bgCellMedium: rowHover,
      bgHeader,
      // Keep the header stable when a cell in the column is focused —
      // otherwise selecting a cell visibly recolors the header.
      bgHeaderHasFocus: bgHeader,
      bgHeaderHovered: rowHover,
      borderColor,
      horizontalBorderColor: borderColor,
      fontFamily,
      textHeader: textDark,
      textHeaderSelected: textDark,
      // Matches the legacy grid's header text exactly
      // (grid/grid-header.tsx's `font-medium text-xs` = 500 weight, 12px);
      // Glide's own default is "600 13px".
      headerFontStyle: "500 12px",
      // Matches the legacy grid's header icon size exactly
      // (grid/grid-header.tsx's `w-3.5 h-3.5` = 14px); Glide's own
      // default is 18.
      headerIconSize: 14,
      // Matches the legacy grid's header type-icon color exactly
      // (grid/grid-header.tsx's `text-foreground/60`) — read by our
      // custom header sprites (header-icons.ts) for their `fgColor`.
      fgIconHeader: textMedium,
      bgIconHeader: bgHeader,
    };
    // Re-derive whenever the resolved light/dark theme or the active
    // custom app theme (id or palette contents) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, appThemeId, customAppThemes]);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface GridHoverColors {
  /** Per-cell hover (always on) — matches legacy `bg-white/[0.03] dark:bg-[#24262b]`. */
  cellHoverColor: string;
  /** Row hover (`gridAnimations`) — matches legacy `hover:bg-studio-accent-purple/5`. */
  rowHoverColor: string;
  /** Column hover (`enableColumnHover`) — matches legacy `background-color: var(--studio-row-hover)` (fully opaque). */
  columnHoverColor: string;
}

export function useGlideHoverColors(): GridHoverColors {
  const { resolvedTheme } = useAppTheme();
  const { appThemeId, customAppThemes } = useGlobalAppTheme();

  return useMemo<GridHoverColors>(() => {
    const isDark = resolvedTheme === "dark";
    const accentPurple = readCssVar("--studio-accent-purple", "#7c3aed");
    const rowHover = readCssVar("--studio-row-hover", isDark ? "#1f1f1f" : "#f8fafc");

    return {
      cellHoverColor: isDark ? "#24262b" : "rgba(255, 255, 255, 0.03)",
      rowHoverColor: hexToRgba(accentPurple, 0.05),
      columnHoverColor: rowHover,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, appThemeId, customAppThemes]);
}
