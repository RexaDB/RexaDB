import type { DashboardWidgetType } from "@/lib/studio/types";

// ─── Layout resolution ────────────────────────────────────────────────────────
// Canonical grid constants (must match DASHBOARD_GRID_SIZE = 40 in dashboard-view.tsx)
const GRID = 40;
const MARGIN_X = 40;   // left edge of first column
const COL_GAP = 20;    // gap between columns
const ROW_GAP = 20;    // gap between rows

// Standard widths (all multiples of 40, fitting inside 1140px canvas)
const W_FULL = 1100;   // x = 40..1140
const W_HALF = 540;    // x = 40 | 600
const W_THIRD = 340;   // x = 40 | 400 | 760
const W_QUARTER = 260; // x = 40 | 320 | 600 | 880

// Standard heights
const H_METRIC = 160;
const H_CHART = 300;
const H_TABLE = 340;
const H_MISC = 200;

// Column start positions for each split
const X_HALF = [MARGIN_X, MARGIN_X + W_HALF + COL_GAP] as const;        // [40, 600]
const X_THIRD = [MARGIN_X, MARGIN_X + W_THIRD + COL_GAP, MARGIN_X + (W_THIRD + COL_GAP) * 2] as const; // [40, 400, 760]
const X_QUARTER = [MARGIN_X, MARGIN_X + W_QUARTER + COL_GAP, MARGIN_X + (W_QUARTER + COL_GAP) * 2, MARGIN_X + (W_QUARTER + COL_GAP) * 3] as const; // [40, 320, 600, 880]

function snapGrid(v: number) {
  return Math.round(v / GRID) * GRID;
}

type WidgetCategory = "metric" | "chart" | "table" | "misc";

const CHART_WIDGET_TYPES = new Set([
  "bar-chart",
  "area-chart",
  "pie-chart",
  "sparkline",
  "p-chart-1",
  "p-chart-2",
  "p-chart-3",
  "p-chart-4",
  "p-chart-12",
  "p-chart-13",
  "p-chart-14",
  "p-chart-15",
  "p-chart-17",
  "p-chart-18",
  "p-chart-19",
  "p-chart-20",
  "p-chart-21",
]);

function isChartWidgetType(widgetType: string): boolean {
  return CHART_WIDGET_TYPES.has(widgetType);
}

function categorizeWidget(widgetType: DashboardWidgetType): WidgetCategory {
  if (widgetType === "metric") return "metric";
  if (widgetType === "table") return "table";
  if (isChartWidgetType(widgetType)) return "chart";
  return "misc";
}

interface SlottedWidget {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Assigns non-overlapping grid positions to a list of widgets based on their
 * category composition. Widgets that already carry explicit AI-provided
 * coordinates skip auto-placement but still participate in overlap detection.
 *
 * Layout strategy:
 *   Row 1+: metrics  — up to 4 per row in quarter columns
 *   Next rows: charts — up to 2 per row in half columns; 1 chart → full width
 *   Next rows: tables — full width
 *   Next rows: misc  — up to 2 per row in half columns
 */
export function resolveLayout(
  widgets: Array<{ widgetType: DashboardWidgetType; hasExplicitPos: boolean }>,
  currentPositions: Array<{ x: number; y: number; width: number; height: number }>,
): SlottedWidget[] {
  const result: SlottedWidget[] = currentPositions.map((p) => ({ ...p }));

  // Separate indices by category
  const byCategory: Record<WidgetCategory, number[]> = {
    metric: [],
    chart: [],
    table: [],
    misc: [],
  };
  for (let i = 0; i < widgets.length; i++) {
    byCategory[categorizeWidget(widgets[i].widgetType)].push(i);
  }

  let cursor = MARGIN_X; // not used directly; we work row by row
  let y = MARGIN_X;      // current Y cursor (starts at MARGIN_X = 40)

  // Helper: place a batch of indices in rows of `perRow` columns
  function placeInRows(
    indices: number[],
    perRow: number,
    colXs: readonly number[],
    colW: number,
    rowH: number,
  ) {
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const col = i % perRow;
      if (col === 0 && i > 0) y += rowH + ROW_GAP; // advance to next row
      result[idx] = { x: colXs[col], y, width: colW, height: rowH };
    }
    if (indices.length > 0) y += rowH + ROW_GAP;
  }

  // Place metrics: 4 per row in quarter columns
  if (byCategory.metric.length > 0) {
    const indices = byCategory.metric;
    const perRow = Math.min(4, indices.length) as 1 | 2 | 3 | 4;
    let colXs: readonly number[];
    let colW: number;
    if (perRow === 1) { colXs = [MARGIN_X]; colW = W_HALF; }
    else if (perRow === 2) { colXs = X_HALF; colW = W_HALF; }
    else if (perRow === 3) { colXs = X_THIRD; colW = W_THIRD; }
    else { colXs = X_QUARTER; colW = W_QUARTER; }

    // Force all rows to use the same layout as the first row
    const groupPerRow = perRow;
    for (let i = 0; i < indices.length; i++) {
      const col = i % groupPerRow;
      if (col === 0 && i > 0) y += H_METRIC + ROW_GAP;
      result[indices[i]] = { x: colXs[col], y, width: colW, height: H_METRIC };
    }
    y += H_METRIC + ROW_GAP;
  }

  // Place charts: 2 per row in half columns; single chart → full width
  if (byCategory.chart.length > 0) {
    const indices = byCategory.chart;
    if (indices.length === 1) {
      result[indices[0]] = { x: MARGIN_X, y, width: W_FULL, height: H_CHART };
      y += H_CHART + ROW_GAP;
    } else {
      placeInRows(indices, 2, X_HALF, W_HALF, H_CHART);
    }
  }

  // Place tables: full width
  if (byCategory.table.length > 0) {
    for (const idx of byCategory.table) {
      result[idx] = { x: MARGIN_X, y, width: W_FULL, height: H_TABLE };
      y += H_TABLE + ROW_GAP;
    }
  }

  // Place misc: 2 per row in half columns
  if (byCategory.misc.length > 0) {
    placeInRows(byCategory.misc, 2, X_HALF, W_HALF, H_MISC);
  }

  return result;
}

// ─── End layout resolution ────────────────────────────────────────────────────

function pickString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickNullableColor(value: unknown) {
  if (value === null) return null;
  const color = pickString(value);
  return color || undefined;
}

function getWidgetConfig(widget: any) {
  return widget?.config_json && typeof widget.config_json === "object" ? widget.config_json : {};
}

function getDashboardBlockWidgets(input: any) {
  if (Array.isArray(input?.widgets)) return input.widgets;
  if (Array.isArray(input?.charts)) {
    return input.charts.map((chart: any) => ({
      ...chart,
      widget_type: chart?.widget_type || chart?.widgetType || chart?.type || "metric",
      config_json: {
        ...(chart?.config_json && typeof chart.config_json === "object" ? chart.config_json : {}),
        x_axis: chart?.x_axis,
        y_axis: chart?.y_axis,
      },
    }));
  }
  return [];
}

function normalizeKeyPart(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getWidgetMatchKey(widget: { title?: string; widgetType?: string }) {
  return `${normalizeKeyPart(widget.widgetType)}::${normalizeKeyPart(widget.title)}`;
}

function coerceWidgetType(value: string): DashboardWidgetType {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "metric" || normalized === "table" || normalized === "text") return normalized;
  if (
    normalized === "p-chart-1"
    || normalized === "p-chart-2"
    || normalized === "p-chart-3"
    || normalized === "p-chart-4"
    || normalized === "p-chart-12"
    || normalized === "p-chart-13"
    || normalized === "p-chart-14"
    || normalized === "p-chart-15"
    || normalized === "p-chart-17"
    || normalized === "p-chart-18"
    || normalized === "p-chart-19"
    || normalized === "p-chart-20"
    || normalized === "p-chart-21"
  ) {
    return normalized as DashboardWidgetType;
  }
  if (normalized === "bar" || normalized === "bar-chart") return "bar-chart";
  if (normalized === "line" || normalized === "line-chart" || normalized === "area" || normalized === "area-chart") {
    return "area-chart";
  }
  if (normalized === "pie" || normalized === "pie-chart") return "pie-chart";
  if (normalized === "sparkline" || normalized === "map" || normalized === "progress") return normalized;
  return "metric";
}

function getWidgetQuery(widget: any) {
  if (typeof widget?.query === "string" && widget.query.trim()) return widget.query.trim();
  if (typeof widget?.config_json?.query === "string" && widget.config_json.query.trim()) {
    return widget.config_json.query.trim();
  }
  const derivedQuery = buildDerivedQuery(widget);
  if (derivedQuery) return derivedQuery;
  return "";
}

function getWidgetTableName(widget: any) {
  if (typeof widget?.table_name === "string" && widget.table_name.trim()) return widget.table_name.trim();
  if (typeof widget?.tableName === "string" && widget.tableName.trim()) return widget.tableName.trim();
  if (typeof widget?.config_json?.table === "string" && widget.config_json.table.trim()) return widget.config_json.table.trim();
  return undefined;
}

function getWidgetSchemaName(widget: any) {
  if (typeof widget?.schema === "string" && widget.schema.trim()) return widget.schema.trim();
  if (typeof widget?.schema_name === "string" && widget.schema_name.trim()) return widget.schema_name.trim();
  return undefined;
}

function getGridCoord(widget: any, key: "x" | "y", fallback: number) {
  const directValue = widget?.[key];
  if (Number.isFinite(directValue)) return Number(directValue);
  const posKey = key === "x" ? "pos_x" : "pos_y";
  const gridValue = widget?.[posKey];
  if (Number.isFinite(gridValue)) return Number(gridValue) * 40;
  return fallback;
}

function hasExplicitCoord(widget: any, key: "x" | "y") {
  const directValue = widget?.[key];
  if (Number.isFinite(directValue)) return true;
  const posKey = key === "x" ? "pos_x" : "pos_y";
  return Number.isFinite(widget?.[posKey]);
}

function hasExplicitSize(widget: any, key: "w" | "h") {
  return Number.isFinite(widget?.[key]);
}

function buildDerivedQuery(widget: any) {
  const widgetType = coerceWidgetType(String(widget?.widget_type || widget?.widgetType || widget?.type || "metric"));
  const tableRef = getWidgetTableName(widget);
  if (!tableRef) return "";

  const config = widget?.config_json && typeof widget.config_json === "object" ? widget.config_json : {};
  const metric = typeof config.metric === "string" && config.metric.trim() ? config.metric.trim() : "";
  const dimension =
    typeof config.dimension === "string" && config.dimension.trim()
      ? config.dimension.trim()
      : typeof config.group_by === "string" && config.group_by.trim()
        ? config.group_by.trim()
        : typeof config.x === "string" && config.x.trim()
          ? config.x.trim()
          : "";
  const limit =
    typeof config.limit === "number" && Number.isFinite(config.limit) && config.limit > 0
      ? Math.floor(config.limit)
      : widgetType === "table"
        ? 100
        : 12;

  if (widgetType === "table") {
    return `SELECT * FROM ${tableRef} LIMIT ${limit};`;
  }

  if (widgetType === "metric" || widgetType === "progress") {
    const metricExpr = metric || "COUNT(*)";
    return `SELECT ${metricExpr} AS value FROM ${tableRef};`;
  }

  if (dimension) {
    const metricExpr = metric || "COUNT(*)";
    return `SELECT ${dimension} AS label, ${metricExpr} AS value FROM ${tableRef} GROUP BY ${dimension} ORDER BY value DESC LIMIT ${limit};`;
  }

  return "";
}

function getWidgetContent(widget: any, widgetType: DashboardWidgetType) {
  if (typeof widget?.content === "string") return widget.content;

  const config = getWidgetConfig(widget);
  const tintColor =
    pickNullableColor(widget?.tintColor)
    ?? pickNullableColor(widget?.color)
    ?? pickNullableColor(widget?.accentColor)
    ?? pickNullableColor(config?.tintColor)
    ?? pickNullableColor(config?.color)
    ?? pickNullableColor(config?.accentColor);

  if (widgetType === "text") {
    const template = pickString(widget?.template) ?? pickString(config?.template);
    if (template || tintColor !== undefined) {
      return JSON.stringify({
        template: template || "",
        tintColor: tintColor ?? null,
      });
    }
  }

  if (widgetType === "metric") {
    return JSON.stringify({
      valueFormat: config?.valueFormat === "compact" || widget?.valueFormat === "compact" ? "compact" : "number",
      tintColor: tintColor ?? null,
      showChange: typeof config?.showChange === "boolean" ? config.showChange : typeof widget?.showChange === "boolean" ? widget.showChange : true,
      colorByChange: typeof config?.colorByChange === "boolean" ? config.colorByChange : typeof widget?.colorByChange === "boolean" ? widget.colorByChange : false,
    });
  }

  if (isChartWidgetType(widgetType)) {
    return JSON.stringify({
      tintColor: tintColor ?? null,
      xLabel: pickString(widget?.xLabel) ?? pickString(config?.xLabel) ?? pickString(config?.x_axis?.label) ?? "",
      yLabel: pickString(widget?.yLabel) ?? pickString(config?.yLabel) ?? pickString(config?.y_axis?.label) ?? "",
    });
  }

  if (widgetType === "sparkline") {
    return JSON.stringify({
      tintColor: tintColor ?? null,
      showIncrease: typeof config?.showIncrease === "boolean" ? config.showIncrease : typeof widget?.showIncrease === "boolean" ? widget.showIncrease : true,
    });
  }

  if (widgetType === "pie-chart") {
    return JSON.stringify({
      tintColor: tintColor ?? null,
    });
  }

  if (widgetType === "map") {
    return JSON.stringify({
      pulse: typeof config?.pulse === "boolean" ? config.pulse : typeof widget?.pulse === "boolean" ? widget.pulse : true,
    });
  }

  if (Object.keys(config).length > 0) return JSON.stringify(config);

  return "";
}

interface ParsedWidget {
  _index: number;
  widgetType: DashboardWidgetType;
  hasExplicitPos: boolean;
  hasExplicitW: boolean;
  hasExplicitH: boolean;
  rawX: number;
  rawY: number;
  rawW: number;
  rawH: number;
  id: string;
  title: string;
  query: string;
  tableName: string | undefined;
  schema: string | undefined;
  content: string;
  conditions: any[];
}

export function buildDashboardWidgetsFromBlock(input: any) {
  const widgets = getDashboardBlockWidgets(input);

  const parsed: ParsedWidget[] = widgets.map((widget: any, index: number) => {
    const widgetType = coerceWidgetType(String(widget?.widget_type || widget?.widgetType || widget?.type || "metric"));
    const hasExplicitPos = hasExplicitCoord(widget, "x") && hasExplicitCoord(widget, "y");
    const hasExplicitW = hasExplicitSize(widget, "w") || Number.isFinite(widget?.width);
    const hasExplicitH = hasExplicitSize(widget, "h") || Number.isFinite(widget?.height);

    // Parse what the AI gave us (or placeholders)
    const rawX = getGridCoord(widget, "x", 0);
    const rawY = getGridCoord(widget, "y", 0);
    const rawW = hasExplicitW
      ? (Number.isFinite(widget?.width) ? snapGrid(widget.width) : widget.w * GRID)
      : 0;
    const rawH = hasExplicitH
      ? (Number.isFinite(widget?.height) ? snapGrid(widget.height) : widget.h * GRID)
      : 0;

    return {
      _index: index,
      widgetType,
      hasExplicitPos,
      hasExplicitW,
      hasExplicitH,
      rawX,
      rawY,
      rawW,
      rawH,
      id: Math.random().toString(36).slice(2, 10),
      title: String(widget?.title || `Widget ${index + 1}`),
      query: getWidgetQuery(widget),
      tableName: getWidgetTableName(widget),
      schema: getWidgetSchemaName(widget),
      content: getWidgetContent(widget, widgetType),
      conditions: [] as any[],
    };
  });

  // Always run the layout resolver — it gives every widget a canonical position,
  // then we overlay explicit AI positions (if valid) on top.
  const resolvedPositions = resolveLayout(
    parsed.map((p) => ({ widgetType: p.widgetType, hasExplicitPos: p.hasExplicitPos })),
    parsed.map((p) => ({ x: p.rawX, y: p.rawY, width: p.rawW, height: p.rawH })),
  );

  return parsed.map((p, i) => {
    const resolved = resolvedPositions[i];
    // Accept the AI's explicit size only when it looks reasonable (>=160px)
    const width = p.hasExplicitW && p.rawW >= 160 ? snapGrid(p.rawW) : resolved.width;
    const height = p.hasExplicitH && p.rawH >= 160 ? snapGrid(p.rawH) : resolved.height;
    // Accept the AI's explicit position only when it looks non-overlapping
    // (we always prefer the resolved layout to eliminate overlaps)
    const x = resolved.x;
    const y = resolved.y;

    return {
      id: p.id,
      widgetType: p.widgetType,
      title: p.title,
      query: p.query,
      tableName: p.tableName,
      schema: p.schema,
      content: p.content,
      conditions: p.conditions,
      x,
      y,
      width,
      height,
    };
  });
}

export function mergeDashboardWidgetsFromBlock(existingWidgets: any[], input: any) {
  const sourceWidgets = getDashboardBlockWidgets(input);
  const builtWidgets = buildDashboardWidgetsFromBlock(input);
  const nextWidgets = Array.isArray(existingWidgets) ? [...existingWidgets] : [];
  const remainingByKey = new Map<string, any[]>();

  for (const widget of nextWidgets) {
    const key = getWidgetMatchKey(widget);
    const current = remainingByKey.get(key) || [];
    current.push(widget);
    remainingByKey.set(key, current);
  }

  for (let index = 0; index < builtWidgets.length; index += 1) {
    const built = builtWidgets[index];
    const source = sourceWidgets[index] || {};
    const key = getWidgetMatchKey(built);
    const matchedPool = remainingByKey.get(key) || [];
    const matched = matchedPool.shift();
    if (matchedPool.length > 0) {
      remainingByKey.set(key, matchedPool);
    } else {
      remainingByKey.delete(key);
    }

    if (!matched) {
      nextWidgets.push(built);
      continue;
    }

    const targetIndex = nextWidgets.findIndex((widget) => widget.id === matched.id);
    if (targetIndex === -1) {
      nextWidgets.push(built);
      continue;
    }

    nextWidgets[targetIndex] = {
      ...matched,
      title: built.title || matched.title,
      widgetType: built.widgetType || matched.widgetType,
      query: built.query || matched.query,
      tableName: built.tableName || matched.tableName,
      schema: built.schema || matched.schema,
      content: built.content || matched.content,
      x: hasExplicitCoord(source, "x") ? built.x : matched.x,
      y: hasExplicitCoord(source, "y") ? built.y : matched.y,
      width: hasExplicitSize(source, "w") ? built.width : matched.width,
      height: hasExplicitSize(source, "h") ? built.height : matched.height,
    };
  }

  return nextWidgets;
}

export function countDashboardBlockWidgets(input: any) {
  return getDashboardBlockWidgets(input).length;
}
