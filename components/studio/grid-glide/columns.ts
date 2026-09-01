import type { GridColumn } from "@glideapps/glide-data-grid";
import { HEADER_ICON_KEYS, typeIconKey } from "./header-icons";

const CHAR_WIDTH = 7.5;
const MIN_WIDTH = 150;
const MAX_WIDTH = 600;
const CELL_PADDING = 20;
const HEADER_ICON_SPACE = 24;

/**
 * Ports the character-width heuristic from the legacy grid
 * (components/studio/data-grid.tsx's `autoColumnWidths`) verbatim, so
 * columns size the same way they did before the rewrite.
 */
export function computeAutoColumnWidths(
  results: { rows?: any[]; fields?: Array<{ name: string }> } | null | undefined,
  tableStructure: any[] | undefined,
): Record<string, number> {
  if (!results?.rows || !results?.fields) return {};

  const widths: Record<string, number> = {};

  results.fields.forEach((field) => {
    const struct = tableStructure?.find(
      (c) => (c.name || c.column_name) === field.name,
    );
    const isPK = struct?.is_primary_key;
    const isFK = struct?.is_foreign_key;

    let headerWidth = field.name.length * CHAR_WIDTH + HEADER_ICON_SPACE;
    if (isPK) headerWidth += 12;
    if (isFK) headerWidth += 12;

    let maxLen = Math.ceil(headerWidth / CHAR_WIDTH);

    const rowsToScan = results.rows!.slice(0, 1000);
    rowsToScan.forEach((row: any) => {
      const val = row[field.name];
      if (val !== null && val !== undefined) {
        const strLen = String(val).length;
        if (strLen > maxLen) maxLen = strLen;
      }
    });

    widths[field.name] = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, maxLen * CHAR_WIDTH + CELL_PADDING),
    );
  });

  return widths;
}

export interface BuildColumnsOptions {
  pendingDeleteColumns?: Set<string>;
  showHeaderIcons?: boolean;
  sortConfig?: { column: string; direction: "ASC" | "DESC" } | null;
}

/**
 * Builds Glide's columns with real titles and real header icons — the
 * type icon (`icon`) and a trailing PK/FK/sort-direction icon
 * (`indicatorIcon`, whichever applies; an actively-sorted column shows the
 * sort arrow there instead of PK/FK while sorted) are rendered by Glide's
 * own native header drawing, using the exact lucide SVGs registered in
 * `header-icons.ts` via the `headerIcons` prop (see
 * `data-grid.tsx` for why that prop needs a small local type bridge
 * instead of a glide-data-grid patch — the runtime already supports it,
 * only its public TypeScript types don't declare it).
 */
export function buildGridColumns(
  results: { fields?: Array<{ name: string }> } | null | undefined,
  tableStructure: any[] | undefined,
  autoWidths: Record<string, number>,
  manualWidths: Record<string, number>,
  hiddenColumns: string[] | undefined,
  options: BuildColumnsOptions = {},
): GridColumn[] {
  const hidden = new Set(hiddenColumns ?? []);
  const fields = results?.fields ?? [];
  const { pendingDeleteColumns, showHeaderIcons = true, sortConfig } = options;

  return fields
    .filter((field) => !hidden.has(field.name))
    .map((field) => {
      const struct = tableStructure?.find(
        (c) => (c.name || c.column_name) === field.name,
      );
      const isPK = !!struct?.is_primary_key;
      const isFK = !!struct?.is_foreign_key;
      const dataType = String(struct?.data_type || struct?.udt_name || "text");
      const width = manualWidths[field.name] ?? autoWidths[field.name] ?? 150;
      const isPendingDelete = !!pendingDeleteColumns?.has(field.name);
      const sortDirection = sortConfig?.column === field.name ? sortConfig.direction : null;

      const indicatorIcon = !showHeaderIcons
        ? undefined
        : sortDirection
          ? sortDirection === "ASC"
            ? HEADER_ICON_KEYS.sortAsc
            : HEADER_ICON_KEYS.sortDesc
          : isPK
            ? HEADER_ICON_KEYS.primaryKey
            : isFK
              ? HEADER_ICON_KEYS.foreignKey
              : undefined;

      return {
        id: field.name,
        title: field.name,
        width,
        // Deliberately false: Glide's own menu affordance is a triangle
        // (not our ChevronDown) and only ever draws/hit-tests while the
        // header is hovered — both wrong for this app. We draw and
        // hit-test our own chevron instead (see `onDrawHeader` and
        // `onHeaderClicked` in data-grid.tsx), and `hasMenu: true` would
        // make Glide intercept clicks in that zone before our handler
        // ever sees them.
        hasMenu: false,
        icon: showHeaderIcons ? typeIconKey(dataType) : undefined,
        indicatorIcon,
        themeOverride: isPendingDelete
          ? { textHeader: "#fca5a5", textHeaderSelected: "#fca5a5" }
          : undefined,
      } satisfies GridColumn;
    });
}
