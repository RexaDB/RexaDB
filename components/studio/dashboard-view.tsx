"use client";

import "leaflet/dist/leaflet.css";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Play, Plus, X } from "@/lib/icon-theme/lucide-react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DashboardHeader } from "./dashboard-header";
import { DataGridAg as DataGrid } from "./data-grid-ag";
import { DataTableToolbar } from "./data-table-toolbar";
import {
  fetchTableForeignKeys,
  fetchTableStructure,
  runQuery,
} from "@/lib/api/actions-client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TintColorPicker } from "./tint-color-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/theme-provider";
import {
  registerCustomMonacoThemes,
  resolveEditorThemeId,
  getStudioDarkTheme,
  type MonacoThemeRef,
} from "@/lib/studio/editor-themes";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import { getDatabaseFromConnectionString } from "@/lib/studio/db-utils";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import type * as LeafletModule from "leaflet";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  preventTextSelection,
  allowTextSelection,
} from "@/lib/prevent-text-selection";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false },
);

type DashboardWidgetType =
  | "empty"
  | "area-chart"
  | "bar-chart"
  | "p-chart-1"
  | "p-chart-2"
  | "p-chart-3"
  | "p-chart-4"
  | "p-chart-12"
  | "p-chart-13"
  | "p-chart-14"
  | "p-chart-15"
  | "p-chart-17"
  | "p-chart-18"
  | "p-chart-19"
  | "p-chart-20"
  | "p-chart-21"
  | "pie-chart"
  | "table"
  | "metric"
  | "sparkline"
  | "map"
  | "progress"
  | "text"
  | "image"
  | "gif";

type DashboardConditionOperator =
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_null"
  | "is_not_null";

type DashboardConditionActionType = "text" | "image" | "gif";

interface DashboardCondition {
  id: string;
  operator: DashboardConditionOperator;
  value?: string;
  actionType: DashboardConditionActionType;
  actionValue: string;
}

interface DashboardWidget {
  id: string;
  widgetType: DashboardWidgetType;
  title: string;
  query?: string;
  tableName?: string;
  schema?: string;
  content?: string;
  conditions?: DashboardCondition[];
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MetricWidgetOptions {
  valueFormat: "number" | "compact";
  tintColor: string | null;
  showChange: boolean;
  colorByChange: boolean;
}

interface BarChartWidgetOptions {
  tintColor: string | null;
  xLabel: string;
  yLabel: string;
}

type AreaChartWidgetOptions = BarChartWidgetOptions;

interface PieChartWidgetOptions {
  tintColor: string | null;
}

interface SparklineWidgetOptions {
  tintColor: string | null;
  showIncrease: boolean;
}

interface TextWidgetOptions {
  template: string;
  tintColor: string | null;
}

interface MapWidgetOptions {
  pulse: boolean;
}

interface DashboardData {
  id: string;
  name: string;
  widgets: DashboardWidget[];
}

interface ActiveWidgetTransform {
  widgetId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
}

interface DashboardViewProps {
  dashboard: DashboardData | null;
  onEditWithAi: (dashboard: DashboardData) => void;
  onRefresh: () => void;
  isLocked: boolean;
  onToggleLock: () => void;
  addDashboardWidgetFromBounds: (
    dashboardId: string,
    bounds: { x: number; y: number; width: number; height: number },
    type?: "query" | "metric" | "chart",
  ) => void;
  updateDashboardWidget: (
    dashboardId: string,
    widgetId: string,
    updates: Partial<{
      title: string;
      query?: string;
      tableName?: string;
      schema?: string;
      content?: string;
      conditions?: DashboardCondition[];
      widgetType: DashboardWidgetType;
      x: number;
      y: number;
      width: number;
      height: number;
    }>,
  ) => void;
  removeDashboardWidget: (dashboardId: string, widgetId: string) => void;
  applyDashboardWidgetLayout: (
    dashboardId: string,
    widgets: DashboardWidget[],
  ) => void;
  tables: string[];
  selectedSchema: string;
  connectionString: string;
  editorThemeId?: string;
  appEditorTheme?: MonacoThemeRef | null;
  vimMode?: boolean;
}

const DASHBOARD_GRID_SIZE = 40;
const DASHBOARD_MIN_SIZE = DASHBOARD_GRID_SIZE * 4;
const WIDGET_GUTTER = 8;

const WIDGET_TYPE_OPTIONS: Array<{
  value: DashboardWidgetType;
  label: string;
}> = [
  { value: "area-chart", label: "Area Chart" },
  { value: "p-chart-13", label: "Area Chart (Gradient)" },
  { value: "p-chart-14", label: "Area Chart (Stacked)" },
  { value: "p-chart-15", label: "Area Chart (Step Dotted)" },
  { value: "p-chart-17", label: "Line + Area (Forecast)" },
  { value: "p-chart-18", label: "Area Chart (Crosshatch)" },
  { value: "bar-chart", label: "Bar Chart" },
  { value: "p-chart-1", label: "Bar Chart (Grid)" },
  { value: "p-chart-2", label: "Bar Chart (Grouped)" },
  { value: "p-chart-3", label: "Bar Chart (Striped)" },
  { value: "p-chart-4", label: "Bar Chart (Dotted)" },
  { value: "p-chart-12", label: "Bar Chart (Horizontal)" },
  { value: "p-chart-19", label: "Bar Chart (Metric)" },
  { value: "p-chart-21", label: "Bar Chart (Stacked Multi)" },
  { value: "p-chart-20", label: "Dot Matrix" },
  { value: "pie-chart", label: "Pie Chart" },
  { value: "table", label: "Table" },
  { value: "metric", label: "Metric" },
  { value: "sparkline", label: "Sparkline" },
  { value: "map", label: "Map" },
  { value: "progress", label: "Progress" },
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "gif", label: "GIF" },
];

const BAR_PATTERN_WIDGET_TYPES = [
  "p-chart-1",
  "p-chart-2",
  "p-chart-3",
  "p-chart-4",
  "p-chart-12",
] as const;
type BarPatternWidgetType = (typeof BAR_PATTERN_WIDGET_TYPES)[number];
const BAR_PATTERN_MULTI_SERIES = new Set<BarPatternWidgetType>([
  "p-chart-2",
  "p-chart-12",
]);

const STACKED_BAR_WIDGET_TYPES = ["p-chart-21"] as const;
type StackedBarWidgetType = (typeof STACKED_BAR_WIDGET_TYPES)[number];

function isStackedBarWidgetType(
  value: DashboardWidgetType,
): value is StackedBarWidgetType {
  return STACKED_BAR_WIDGET_TYPES.includes(value as StackedBarWidgetType);
}
const BAR_PATTERN_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const AREA_PATTERN_WIDGET_TYPES = [
  "p-chart-13",
  "p-chart-14",
  "p-chart-15",
  "p-chart-17",
  "p-chart-18",
] as const;
type AreaPatternWidgetType = (typeof AREA_PATTERN_WIDGET_TYPES)[number];
const AREA_PATTERN_MULTI_SERIES = new Set<AreaPatternWidgetType>([
  "p-chart-14",
  "p-chart-18",
]);
const AREA_PATTERN_STACKED = new Set<AreaPatternWidgetType>([
  "p-chart-14",
  "p-chart-18",
]);

function isBarPatternWidgetType(
  value: DashboardWidgetType,
): value is BarPatternWidgetType {
  return BAR_PATTERN_WIDGET_TYPES.includes(value as BarPatternWidgetType);
}

function isBarLikeWidgetType(value: DashboardWidgetType) {
  return (
    value === "bar-chart" ||
    isBarPatternWidgetType(value) ||
    isStackedBarWidgetType(value) ||
    value === "p-chart-19" ||
    value === "p-chart-20"
  );
}

function isAreaPatternWidgetType(
  value: DashboardWidgetType,
): value is AreaPatternWidgetType {
  return AREA_PATTERN_WIDGET_TYPES.includes(value as AreaPatternWidgetType);
}

function isAreaLikeWidgetType(value: DashboardWidgetType) {
  return value === "area-chart" || isAreaPatternWidgetType(value);
}

function formatSeriesLabel(value: string) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

const CONDITION_OPERATOR_OPTIONS: Array<{
  value: DashboardConditionOperator;
  label: string;
}> = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "greater than or equals" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "less than or equals" },
  { value: "is_null", label: "is null" },
  { value: "is_not_null", label: "is not null" },
];

const CONDITION_ACTION_OPTIONS: Array<{
  value: DashboardConditionActionType;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "gif", label: "GIF" },
];

const METRIC_TINT_TEXT_COLOR = "#e6c4a1";
const DEFAULT_BAR_CHART_OPTIONS: BarChartWidgetOptions = {
  tintColor: "#ef4444",
  xLabel: "",
  yLabel: "",
};
const DEFAULT_AREA_CHART_OPTIONS: AreaChartWidgetOptions = {
  tintColor: null,
  xLabel: "",
  yLabel: "",
};
const DEFAULT_PIE_CHART_OPTIONS: PieChartWidgetOptions = {
  tintColor: null,
};
const DEFAULT_SPARKLINE_WIDGET_OPTIONS: SparklineWidgetOptions = {
  tintColor: "#3b82f6",
  showIncrease: false,
};
const DEFAULT_TEXT_WIDGET_OPTIONS: TextWidgetOptions = {
  template: "",
  tintColor: null,
};
const DEFAULT_MAP_WIDGET_OPTIONS: MapWidgetOptions = {
  pulse: true,
};
const DEFAULT_BAR_CHART_PREVIEW_DATA: SimpleChartPoint[] = [
  { label: "Jan", value: 62 },
  { label: "Feb", value: 95 },
  { label: "Mar", value: 78 },
  { label: "Apr", value: 24 },
  { label: "May", value: 68 },
  { label: "Jun", value: 70 },
  { label: "Jul", value: 88 },
  { label: "Aug", value: 82 },
  { label: "Sep", value: 64 },
  { label: "Oct", value: 100 },
  { label: "Nov", value: 85 },
  { label: "Dec", value: 106 },
];
const DEFAULT_BAR_CHART_MULTI_SERIES_PREVIEW: MultiSeriesChartPoint[] = [
  { label: "Jan", desktop: 120, mobile: 80 },
  { label: "Feb", desktop: 250, mobile: 200 },
  { label: "Mar", desktop: 230, mobile: 120 },
  { label: "Apr", desktop: 70, mobile: 190 },
  { label: "May", desktop: 209, mobile: 130 },
  { label: "Jun", desktop: 210, mobile: 140 },
];
const DEFAULT_BAR_CHART_SINGLE_SERIES_PREVIEW: MultiSeriesChartPoint[] =
  DEFAULT_BAR_CHART_PREVIEW_DATA.map((point) => ({
    label: point.label,
    value: point.value,
  }));
const DEFAULT_AREA_CHART_PREVIEW_DATA: MultiSeriesChartPoint[] = [
  { label: "Jan", products: 10, baseline: 14 },
  { label: "Feb", products: 13, baseline: 18 },
  { label: "Mar", products: 12, baseline: 16 },
  { label: "Apr", products: 7, baseline: 12 },
  { label: "May", products: 11, baseline: 14 },
  { label: "Jun", products: 10.5, baseline: 14.2 },
  { label: "Jul", products: 12.2, baseline: 16.4 },
  { label: "Aug", products: 11.3, baseline: 15.2 },
];
const DEFAULT_SPARKLINE_PREVIEW_DATA: SimpleChartPoint[] = [
  { label: "Jan", value: 38 },
  { label: "Feb", value: 52 },
  { label: "Mar", value: 47 },
  { label: "Apr", value: 81 },
  { label: "May", value: 64 },
  { label: "Jun", value: 93 },
  { label: "Jul", value: 76 },
  { label: "Aug", value: 87 },
];
const DEFAULT_MAP_POINTS: MapPoint[] = [
  { label: "San Francisco", lat: 37.7749, lon: -122.4194, color: "#3b82f6" },
  { label: "Berlin", lat: 52.52, lon: 13.405, color: "#14b8a6" },
  { label: "Tokyo", lat: 35.6762, lon: 139.6503, color: "#f59e0b" },
  { label: "Sydney", lat: -33.8688, lon: 151.2093, color: "#a855f7" },
];
const DEFAULT_METRIC_OPTIONS: MetricWidgetOptions = {
  valueFormat: "number",
  tintColor: null,
  showChange: true,
  colorByChange: false,
};

function parseTintColor(
  value: unknown,
  defaultColor: string | null,
): string | null {
  return value === null
    ? null
    : typeof value === "string" && value.trim()
      ? value
      : defaultColor;
}

function tryParseWidgetJson<T>(
  raw: string | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseWidgetBase<T extends { tintColor: string | null }>(
  raw: string | undefined,
  defaults: T,
): { parsed: Record<string, unknown> | null; options: T } {
  const parsed = tryParseWidgetJson(raw);
  if (!parsed) return { parsed: null, options: defaults };
  return {
    parsed,
    options: { ...defaults, tintColor: parseTintColor(parsed.tintColor, defaults.tintColor) } as T,
  };
}

function parseMetricWidgetOptions(
  raw: string | undefined,
): MetricWidgetOptions {
  const { parsed, options } = parseWidgetBase(raw, DEFAULT_METRIC_OPTIONS);
  if (!parsed) return options;
  const valueFormat = parsed.valueFormat === "compact" ? "compact" : "number";
  return {
    ...options,
    valueFormat,
    showChange: typeof parsed.showChange === "boolean" ? parsed.showChange : options.showChange,
    colorByChange: typeof parsed.colorByChange === "boolean" ? parsed.colorByChange : options.colorByChange,
  };
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function adjustHexColor(hex: string, amount: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.r + amount, rgb.g + amount, rgb.b + amount);
}

function getMetricTintBackground(tintColor: string | null) {
  if (!tintColor) return undefined;
  const start = adjustHexColor(tintColor, -45);
  const mid = adjustHexColor(tintColor, -10);
  const end = adjustHexColor(tintColor, 15);
  return `linear-gradient(145deg, ${start} 0%, ${mid} 55%, ${end} 100%)`;
}

function parseMetricConditionColor(raw: string | undefined) {
  if (!raw) return null;
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : null;
}

function hasMetricTint(widget: DashboardWidget) {
  if (widget.widgetType !== "metric") return false;
  const options = parseMetricWidgetOptions(widget.content);
  return !!options.tintColor;
}

function parseBarChartWidgetOptions(
  raw: string | undefined,
): BarChartWidgetOptions {
  const { parsed, options } = parseWidgetBase(raw, DEFAULT_BAR_CHART_OPTIONS);
  if (!parsed) return options;
  return {
    ...options,
    xLabel: typeof parsed.xLabel === "string" ? parsed.xLabel : options.xLabel,
    yLabel: typeof parsed.yLabel === "string" ? parsed.yLabel : options.yLabel,
  };
}

const parseAreaChartWidgetOptions = parseBarChartWidgetOptions;

function parsePieChartWidgetOptions(
  raw: string | undefined,
): PieChartWidgetOptions {
  const { options } = parseWidgetBase(raw, DEFAULT_PIE_CHART_OPTIONS);
  return options;
}

function parseSparklineWidgetOptions(
  raw: string | undefined,
): SparklineWidgetOptions {
  const { parsed, options } = parseWidgetBase(raw, DEFAULT_SPARKLINE_WIDGET_OPTIONS);
  if (!parsed) return options;
  return {
    ...options,
    showIncrease: typeof parsed.showIncrease === "boolean" ? parsed.showIncrease : options.showIncrease,
  };
}

function parseTextWidgetOptions(raw: string | undefined): TextWidgetOptions {
  if (!raw) return DEFAULT_TEXT_WIDGET_OPTIONS;
  const { parsed, options } = parseWidgetBase(raw, DEFAULT_TEXT_WIDGET_OPTIONS);
  if (!parsed) return { template: raw, tintColor: null };
  return {
    ...options,
    template: typeof parsed.template === "string" ? parsed.template : "",
  };
}

function renderTextTemplate(
  template: string,
  row: Record<string, unknown> | null,
) {
  if (!template) return "";
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      if (!row || !(key in row)) return `{{${key}}}`;
      const value = row[key];
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    },
  );
}

function previewCellText(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatAxisLabel(value: unknown) {
  const raw = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(5);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw.slice(0, 5);
  return raw.length > 12 ? `${raw.slice(0, 12)}...` : raw;
}

function buildPatternChartConfig(
  seriesKeys: string[],
  tintColor: string | null,
  singleSeriesLabel?: string,
) {
  const keys = seriesKeys.length ? seriesKeys : ["value"];
  return keys.reduce((acc, key, index) => {
    acc[key] = {
      label:
        keys.length === 1 && singleSeriesLabel
          ? singleSeriesLabel
          : formatSeriesLabel(key),
      color:
        tintColor && index === 0
          ? tintColor
          : BAR_PATTERN_COLORS[index % BAR_PATTERN_COLORS.length],
    };
    return acc;
  }, {} as ChartConfig);
}

function parseMapWidgetOptions(raw: string | undefined): MapWidgetOptions {
  if (!raw) return DEFAULT_MAP_WIDGET_OPTIONS;
  const parsed = tryParseWidgetJson(raw);
  if (!parsed) return DEFAULT_MAP_WIDGET_OPTIONS;
  return {
    pulse: typeof parsed.pulse === "boolean" ? parsed.pulse : DEFAULT_MAP_WIDGET_OPTIONS.pulse,
  };
}

function buildTintPalette(baseColor: string, count: number) {
  const steps = [34, 22, 10, -2, -14, -26, -38, -50];
  return Array.from({ length: count }, (_, index) =>
    adjustHexColor(baseColor, steps[index % steps.length]),
  );
}

interface MapPoint {
  label: string;
  lat: number;
  lon: number;
  color?: string;
}
let leafletImportPromise: Promise<typeof import("leaflet")> | null = null;
function loadLeafletModule() {
  if (!leafletImportPromise) {
    leafletImportPromise = import("leaflet");
  }
  return leafletImportPromise;
}

function normalizeMapQueryResult(
  data:
    | {
        rows?: Array<Record<string, unknown>>;
        fields?: Array<{ name: string }>;
      }
    | null
    | undefined,
) {
  const rows = data?.rows || [];
  const fields = (data?.fields || [])
    .map((field) => field.name)
    .filter(Boolean);
  if (!rows.length || !fields.length) return [] as MapPoint[];

  const lower = fields.map((field) => field.toLowerCase());
  const latField =
    fields[lower.findIndex((name) => name.includes("lat"))] || "";
  const lonField =
    fields[
      lower.findIndex(
        (name) =>
          name.includes("lon") || name.includes("lng") || name.includes("long"),
      )
    ] || "";
  if (!latField || !lonField) return [] as MapPoint[];

  const colorField =
    fields[lower.findIndex((name) => name.includes("color"))] || "";
  const labelField =
    fields.find(
      (field) =>
        field !== latField && field !== lonField && field !== colorField,
    ) || latField;

  return rows
    .map((row) => {
      const lat = toNumericValue(row[latField]);
      const lon = toNumericValue(row[lonField]);
      if (lat === null || lon === null) return null;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      const colorRaw = colorField ? String(row[colorField] ?? "").trim() : "";
      return {
        label: String(row[labelField] ?? "").trim() || "Location",
        lat,
        lon,
        color: /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : undefined,
      } satisfies MapPoint;
    })
    .filter(Boolean)
    .slice(0, 200) as MapPoint[];
}

function getConditionActionTypeForWidget(
  widgetType: DashboardWidgetType,
): DashboardConditionActionType {
  if (widgetType === "image") return "image";
  if (widgetType === "gif") return "gif";
  return "text";
}

function snapToGrid(value: number) {
  return Math.round(value / DASHBOARD_GRID_SIZE) * DASHBOARD_GRID_SIZE;
}

function snapPosition(value: number) {
  return Math.max(0, snapToGrid(value));
}

function snapSize(value: number) {
  return Math.max(DASHBOARD_MIN_SIZE, snapToGrid(value));
}

function quoteIdentifier(input: string, dbType: string) {
  if (dbType === "mysql" || dbType === "clickhouse") {
    return `\`${String(input || "").replace(/`/g, "``")}\``;
  }
  if (dbType === "mssql") {
    return `[${String(input || "").replace(/]/g, "]]")}]`;
  }
  return `"${String(input || "").replace(/"/g, '""')}"`;
}

function quoteTableRef(schema: string, table: string, dbType: string) {
  return `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`;
}

function selectWithLimit(tableRef: string, limit: number, dbType: string) {
  if (dbType === "mssql") {
    return `SELECT TOP ${limit} * FROM ${tableRef}`;
  }
  return `SELECT * FROM ${tableRef} LIMIT ${limit}`;
}

function selectWithOrderLimit(
  tableRef: string,
  orderBy: string,
  limit: number,
  dbType: string,
) {
  if (dbType === "mssql") {
    return `SELECT TOP ${limit} * FROM ${tableRef} ORDER BY ${orderBy}`;
  }
  return `SELECT * FROM ${tableRef} ORDER BY ${orderBy} LIMIT ${limit}`;
}

function lintSqlQuery(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return "Query cannot be empty.";

  if (!/\bselect\b/i.test(trimmed)) {
    return "Query must include a SELECT statement.";
  }

  let parenDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];

    if (!inDoubleQuote && ch === "'") {
      if (inSingleQuote && next === "'") {
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === "(") parenDepth += 1;
    if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) return "Unbalanced parentheses in SQL query.";
    }
  }

  if (inSingleQuote) return "Unclosed single quote in SQL query.";
  if (inDoubleQuote) return "Unclosed double quote in SQL query.";
  if (parenDepth !== 0) return "Unbalanced parentheses in SQL query.";

  return "";
}

function parseComparableValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const maybe = Number(String(value));
  if (!Number.isNaN(maybe) && String(value).trim() !== "") return maybe;
  return String(value);
}

function toNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const maybe = Number(trimmed);
    if (Number.isFinite(maybe)) return maybe;
  }
  return null;
}

interface SimpleChartPoint {
  label: string;
  value: number;
}

interface MultiSeriesChartPoint {
  label: string;
  [key: string]: string | number;
}

interface TablePreviewRow {
  [key: string]: string;
}

interface TablePreviewResults {
  fields: Array<{ name: string }>;
  rows: TablePreviewRow[];
}

const CHART_COLORS = [
  "#3b82f6",
  "#14b8a6",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
];

const DEFAULT_TABLE_PREVIEW_ROWS: TablePreviewRow[] = [
  { id: "1", name: "Alpha", status: "active" },
  { id: "2", name: "Beta", status: "pending" },
  { id: "3", name: "Gamma", status: "active" },
];

const DEFAULT_TABLE_PREVIEW_RESULTS: TablePreviewResults = {
  fields: [{ name: "id" }, { name: "name" }, { name: "status" }],
  rows: DEFAULT_TABLE_PREVIEW_ROWS,
};

function normalizeTablePreviewResult(
  data:
    | {
        rows?: Array<Record<string, unknown>>;
        fields?: Array<{ name: string }>;
      }
    | null
    | undefined,
) {
  const fields = (data?.fields || [])
    .map((field) => field.name)
    .filter((name) => Boolean(name))
    .slice(0, 6);
  if (!fields.length) {
    return DEFAULT_TABLE_PREVIEW_RESULTS;
  }

  const rows = (data?.rows || []).slice(0, 100).map((row) => {
    const normalized: TablePreviewRow = {};
    fields.forEach((fieldName) => {
      const value = row[fieldName];
      normalized[fieldName] =
        value === null || value === undefined
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
    });
    return normalized;
  });

  const normalizedRows = rows.length
    ? rows
    : [{ ...Object.fromEntries(fields.map((field) => [field, ""])) }];
  return {
    fields: fields.map((fieldName) => ({ name: fieldName })),
    rows: normalizedRows,
  };
}

function extractQueryData(
  data:
    | {
        rows?: Array<Record<string, unknown>>;
        fields?: Array<{ name: string }>;
      }
    | null
    | undefined,
): { rows: Array<Record<string, unknown>>; fields: string[] } | null {
  const rows = data?.rows || [];
  const fields = (data?.fields || [])
    .map((field) => field.name)
    .filter(Boolean);
  if (rows.length === 0 || fields.length === 0) return null;
  return { rows, fields };
}

function normalizeChartQueryResult(
  data:
    | {
        rows?: Array<Record<string, unknown>>;
        fields?: Array<{ name: string }>;
      }
    | null
    | undefined,
  options?: { positiveOnly?: boolean; limit?: number },
): SimpleChartPoint[] {
  const extracted = extractQueryData(data);
  if (!extracted) return [];
  const { rows, fields } = extracted;

  const numericField = fields.find((fieldName) =>
    rows.some((row) => toNumericValue(row[fieldName]) !== null),
  );
  if (!numericField) return [];

  const labelField =
    fields.find((fieldName) => fieldName !== numericField) || numericField;

  return rows
    .map((row, index) => {
      const numericValue = toNumericValue(row[numericField]);
      if (numericValue === null) return null;
      if (options?.positiveOnly && numericValue <= 0) return null;

      const labelSource = row[labelField];
      const label =
        labelField === numericField
          ? `#${index + 1}`
          : labelSource === null ||
              labelSource === undefined ||
              String(labelSource).trim() === ""
            ? "(empty)"
            : String(labelSource);

      return { label, value: numericValue };
    })
    .filter(Boolean)
    .slice(0, options?.limit ?? 50) as SimpleChartPoint[];
}

function normalizeMultiSeriesChartResult(
  data:
    | {
        rows?: Array<Record<string, unknown>>;
        fields?: Array<{ name: string }>;
      }
    | null
    | undefined,
  options?: { limit?: number },
): { points: MultiSeriesChartPoint[]; seriesKeys: string[] } {
  const extracted = extractQueryData(data);
  if (!extracted) return { points: [], seriesKeys: [] };
  const { rows, fields } = extracted;

  const numericFields = fields.filter((fieldName) =>
    rows.some((row) => toNumericValue(row[fieldName]) !== null),
  );
  if (numericFields.length === 0) return { points: [], seriesKeys: [] };

  const labelField =
    fields.find((fieldName) => !numericFields.includes(fieldName)) || fields[0];

  const points = rows
    .map((row, index) => {
      const point: MultiSeriesChartPoint = {
        label:
          labelField && labelField !== numericFields[0]
            ? row[labelField] === null ||
              row[labelField] === undefined ||
              String(row[labelField]).trim() === ""
              ? "(empty)"
              : String(row[labelField])
            : `#${index + 1}`,
      };
      numericFields.forEach((seriesKey) => {
        point[seriesKey] = toNumericValue(row[seriesKey]) ?? 0;
      });
      return point;
    })
    .slice(0, options?.limit ?? 120);

  return { points, seriesKeys: numericFields };
}

function matchesCondition(value: unknown, condition: DashboardCondition) {
  const parsed = parseComparableValue(value);
  const compare = parseComparableValue(condition.value ?? "");

  switch (condition.operator) {
    case "is_null":
      return parsed === null;
    case "is_not_null":
      return parsed !== null;
    case "equals":
      return parsed === compare;
    case "not_equals":
      return parsed !== compare;
    case "gt":
      return typeof parsed === "number" && typeof compare === "number"
        ? parsed > compare
        : String(parsed) > String(compare);
    case "gte":
      return typeof parsed === "number" && typeof compare === "number"
        ? parsed >= compare
        : String(parsed) >= String(compare);
    case "lt":
      return typeof parsed === "number" && typeof compare === "number"
        ? parsed < compare
        : String(parsed) < String(compare);
    case "lte":
      return typeof parsed === "number" && typeof compare === "number"
        ? parsed <= compare
        : String(parsed) <= String(compare);
    default:
      return false;
  }
}

function renderConditionAction(
  actionType: DashboardConditionActionType,
  actionValue: string,
) {
  if (actionType === "text") {
    return (
      <div className="text-sm font-semibold tracking-tight">
        {actionValue || "-"}
      </div>
    );
  }
  if (actionType === "image" || actionType === "gif") {
    if (!actionValue)
      return (
        <div className="text-sm text-muted-foreground">
          No media URL configured
        </div>
      );
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={actionValue}
        alt="Condition output"
        className="max-h-full max-w-full object-contain rounded-[3px]"
      />
    );
  }
  return null;
}

function isQueryWidgetType(widgetType: DashboardWidgetType) {
  return (
    widgetType === "metric" ||
    widgetType === "area-chart" ||
    widgetType === "bar-chart" ||
    widgetType === "p-chart-1" ||
    widgetType === "p-chart-2" ||
    widgetType === "p-chart-3" ||
    widgetType === "p-chart-4" ||
    widgetType === "p-chart-12" ||
    widgetType === "p-chart-13" ||
    widgetType === "p-chart-14" ||
    widgetType === "p-chart-15" ||
    widgetType === "p-chart-17" ||
    widgetType === "p-chart-18" ||
    widgetType === "p-chart-19" ||
    widgetType === "p-chart-20" ||
    widgetType === "p-chart-21" ||
    widgetType === "pie-chart" ||
    widgetType === "sparkline" ||
    widgetType === "map" ||
    widgetType === "progress"
  );
}

function widgetSupportsConditions(widgetType: DashboardWidgetType) {
  return (
    isQueryWidgetType(widgetType) ||
    widgetType === "image" ||
    widgetType === "gif"
  );
}

function widgetsDoOverlap(a: DashboardWidget, b: DashboardWidget) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function hasSpaceForWidget(
  widgets: DashboardWidget[],
  widgetId: string,
  candidate: DashboardWidget,
) {
  return widgets.every((widget) => {
    if (widget.id === widgetId) return true;
    return !widgetsDoOverlap(candidate, widget);
  });
}

function useWidgetQueryState() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { loading, setLoading, error, setError };
}

function extractFieldsAndRow(
  data:
    | {
        rows?: Array<Record<string, unknown>>;
        fields?: Array<{ name: string }>;
      }
    | null
    | undefined,
): { fields: string[]; row: Record<string, unknown> } | null {
  if (!data) return null;
  const fields =
    data.fields?.map((field: { name: string }) => field.name) || [];
  const row = data.rows?.[0];
  if (!row || fields.length === 0) return null;
  return { fields, row };
}

function processMultiSeriesChartData(
  data: any,
  setChartData: (data: MultiSeriesChartPoint[]) => void,
  setSeriesKeys: (keys: string[]) => void,
  setError: (error: string | null) => void,
  options: {
    errorMessage: string;
    seriesLimit: number;
    normalizeLimit: number;
  },
) {
  if (!data) {
    setChartData([]);
    setSeriesKeys([]);
    return;
  }

  const normalized = normalizeMultiSeriesChartResult(data, {
    limit: options.normalizeLimit,
  });
  let nextSeriesKeys = normalized.seriesKeys.slice(0, options.seriesLimit);
  let nextPoints = normalized.points;

  if (!nextSeriesKeys.length || !nextPoints.length) {
    const simplePoints = normalizeChartQueryResult(data, {
      limit: options.normalizeLimit,
    });
    if (!simplePoints.length) {
      setError(options.errorMessage);
      setChartData([]);
      setSeriesKeys([]);
      return;
    }
    nextSeriesKeys = ["value"];
    nextPoints = simplePoints.map((point) => ({
      label: point.label,
      value: point.value,
    }));
  } else {
    nextPoints = normalized.points.map((point) => {
      const rebuilt: MultiSeriesChartPoint = { label: point.label };
      nextSeriesKeys.forEach((key) => {
        rebuilt[key] = point[key] ?? 0;
      });
      return rebuilt;
    });
  }

  setChartData(nextPoints);
  setSeriesKeys(nextSeriesKeys);
}

function MetricPreviewContent({
  title,
  showChange,
  deltaPct,
  deltaBadgeClass,
  colorByChange,
  tintColor,
  formattedValue,
}: {
  title: string;
  showChange: boolean;
  deltaPct: number | null;
  deltaBadgeClass: string;
  colorByChange: boolean;
  tintColor: string | null;
  formattedValue: string;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className="text-xs truncate"
          style={tintColor ? { color: METRIC_TINT_TEXT_COLOR } : undefined}
        >
          {title}
        </span>
        {showChange ? (
          <span
            className={deltaBadgeClass}
            style={
              !colorByChange && tintColor
                ? {
                    color: METRIC_TINT_TEXT_COLOR,
                    borderColor: "rgba(230,196,161,0.72)",
                    backgroundColor: "rgba(230,196,161,0.16)",
                  }
                : undefined
            }
          >
            ↗{" "}
            {deltaPct === null
              ? "+12.5%"
              : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
          </span>
        ) : null}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm font-semibold tracking-tight tabular-nums">
          {formattedValue}
        </span>
      </div>
    </>
  );
}

function useChartWidgetState<TOptions, TData = MultiSeriesChartPoint>(widget: DashboardWidget, parseOptions: (content: string | undefined) => TOptions) {
  const [chartData, setChartData] = useState<TData[]>([]);
  const [seriesKeys, setSeriesKeys] = useState<string[]>([]);
  const options = useMemo(() => parseOptions(widget.content), [widget.content]);
  return { chartData, setChartData, seriesKeys, setSeriesKeys, options };
}

function useWidgetChartLoad(
  connectionString: string,
  query: string | null | undefined,
  errorMsg: string,
  processData: (data: any) => void,
  deps: any[] = [],
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processRef = useRef(processData);
  processRef.current = processData;

  useEffect(() => {
    const q = query?.trim();
    if (!q) {
      processRef.current(null);
      setError(null);
      return;
    }
    let active = true;
    const load = async () => {
      const data = await executeWidgetQuery(
        connectionString,
        q,
        () => active,
        setLoading,
        setError,
        errorMsg,
      );
      if (!data) return;
      processRef.current(data);
      setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [connectionString, query, errorMsg, ...deps]);

  return { loading, error, setError };
}

function useChartLoad(
  connectionString: string,
  query: string | null | undefined,
  normOptions: { positiveOnly?: boolean; limit?: number },
  errorMsg: string,
  setChartData: (points: SimpleChartPoint[]) => void,
  refreshKey: number,
) {
  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    query,
    "Failed to run chart query",
    (data) => {
      if (!data) {
        setChartData([]);
        return;
      }
      const points = normalizeChartQueryResult(data, normOptions);
      if (points.length === 0) {
        setChartData([]);
        setError(errorMsg);
        return;
      }
      setChartData(points);
    },
    [refreshKey],
  );
  return { loading, error, setError };
}

async function executeWidgetQuery(
  connectionString: string,
  query: string,
  isActive: () => boolean,
  setLoading: (v: boolean) => void,
  setError: (e: string | null) => void,
  errorMessage: string,
): Promise<{
  rows: Array<Record<string, unknown>>;
  fields: Array<{ name: string }>;
} | null> {
  setLoading(true);
  setError(null);
  let res;
  try {
    res = await runQuery(connectionString, query);
  } catch {
    if (!isActive()) return null;
    setError(errorMessage);
    setLoading(false);
    return null;
  }
  if (!isActive()) return null;
  if (!res.success || !res.data) {
    setError(res.error || errorMessage);
    setLoading(false);
    return null;
  }
  return res.data;
}

function formatTooltipNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(num);
}

function createRowToggleHandler(
  setter: React.Dispatch<React.SetStateAction<Set<number>>>,
) {
  return (index: number) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
}

function dataGridRowIdGetter(row: unknown, index: number): string {
  if (row && typeof row === "object" && "id" in row)
    return `id:${String((row as Record<string, unknown>).id)}`;
  return `idx:${index}`;
}

const DEFAULT_TOOLTIP_CONTENT_STYLE: Record<string, string> = {
  backgroundColor: "#0b1220",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  color: "#e2e8f0",
  fontSize: "12px",
};

interface WidgetQueryProps {
  widget: DashboardWidget;
  connectionString: string;
  refreshKey: number;
}

function ChartGridAndAxis({ children }: { children?: ReactNode }) {
  return (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis
        dataKey="label"
        axisLine={false}
        tickLine={false}
        tickMargin={8}
        tickFormatter={formatAxisLabel}
      />
      {children}
    </>
  );
}

function WidgetXLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/80">
      {label}
    </span>
  );
}

function WidgetTintPicker({
  value,
  onChange,
  label,
  triggerSize,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  triggerSize?: "sm" | "lg";
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        Tint color
      </span>
      <TintColorPicker
        value={value}
        onChange={onChange}
        label={label}
        triggerSize={triggerSize}
      />
    </div>
  );
}

function WidgetAreaDefsAndAxis({
  seriesKeys,
  tintColor,
  gradientId,
  tickFill,
}: {
  seriesKeys: string[];
  tintColor: string | null;
  gradientId: (seriesKey: string, index: number) => string;
  tickFill?: string;
}) {
  return (
    <>
      <defs>
        {seriesKeys.map((seriesKey, index) => (
          <linearGradient
            key={seriesKey}
            id={gradientId(seriesKey, index)}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor={
                index === 0 && tintColor
                  ? tintColor
                  : CHART_COLORS[index % CHART_COLORS.length]
              }
              stopOpacity={0.32}
            />
            <stop offset="100%" stopColor="#0f1b31" stopOpacity={0.05} />
          </linearGradient>
        ))}
      </defs>
      <XAxis
        dataKey="label"
        axisLine={false}
        tickLine={false}
        interval="preserveStartEnd"
        minTickGap={24}
        tickMargin={8}
        tickFormatter={formatAxisLabel}
        tick={{ fontSize: 11, fill: tickFill || "#7f8796" }}
      />
    </>
  );
}

function ChartGridTooltip() {
  return (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        tickFormatter={formatAxisLabel}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            indicator="dot"
            className="min-w-40 gap-2.5"
            labelFormatter={(value) => (
              <div className="border-border/50 mb-0.5 border-b pb-2">
                <span className="text-xs font-medium">{value}</span>
              </div>
            )}
          />
        }
      />
    </>
  );
}

function TableWidget({
  widget,
  connectionString,
  selectedSchema,
  refreshKey,
}: {
  widget: DashboardWidget;
  connectionString: string;
  selectedSchema: string;
  refreshKey: number;
}) {
  const dbType = useMemo(
    () => detectConnectionDbType(connectionString),
    [connectionString],
  );
  const fallbackSchema =
    (dbType === "postgres" || dbType === "supabase-mgmt")
      ? "public"
      : dbType === "mssql"
        ? "dbo"
        : getDatabaseFromConnectionString(connectionString);
  const tableName = widget.tableName;
  const customQuery = widget.query?.trim();
  const schema = widget.schema || selectedSchema || fallbackSchema || "public";
  const {
    rowSpacing,
    alternatingRowColors,
    glassmorphicHeaders,
    gridAnimations,
    sleekSelection,
    colorizedPills,
    relativeDates,
    richJsonInspector,
    dataBars,
    skeletonLoaders,
  } = useGlobalStudioSettings(true);
  const [results, setResults] = useState<any>(null);
  const [structure, setStructure] = useState<any[]>([]);
  const [foreignKeys, setForeignKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedCell, setSelectedCell] = useState<any>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<any>(null);
  const [pendingChanges, setPendingChanges] = useState<any>({});
  const [filterQuery, setFilterQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "ASC" | "DESC";
  } | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchScope, setGlobalSearchScope] = useState<"page" | "table">(
    "page",
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const latestFetchParams = useRef({
    filterQuery,
    globalSearchQuery,
    globalSearchScope,
    hiddenColumns,
    sortConfig,
    page,
    pageSize,
    results,
  });
  latestFetchParams.current = {
    filterQuery,
    globalSearchQuery,
    globalSearchScope,
    hiddenColumns,
    sortConfig,
    page,
    pageSize,
    results,
  };

  const quoteCol = (col: string) => {
    if (dbType === "mysql" || dbType === "clickhouse")
      return `\`${col.replace(/`/g, "``")}\``;
    if (dbType === "mssql") return `[${col.replace(/]/g, "]]")}]`;
    return `"${col.replace(/"/g, '""')}"`;
  };

  const fetchData = useCallback(async () => {
    if (!tableName && !customQuery) return;
    const p = latestFetchParams.current;
    const query = customQuery;
    if (!query) {
      const tableRef = quoteTableRef(schema, tableName!, dbType);
      let where = "";
      if (p.filterQuery) {
        where = ` WHERE ${p.filterQuery}`;
      } else if (
        p.globalSearchQuery &&
        p.globalSearchScope === "page" &&
        p.results?.fields?.length
      ) {
        const searchVal = p.globalSearchQuery.replace(/'/g, "''");
        const fieldArr = p.results.fields;
        const conditions = fieldArr
          .filter((f: any) => !p.hiddenColumns.includes(f.name || f))
          .map((f: any) => {
            const colName = f.name || f;
            const q = quoteCol(colName);
            if (dbType === "mssql")
              return `CAST(${q} AS NVARCHAR(MAX)) LIKE '%${searchVal}%'`;
            return `CAST(${q} AS TEXT) LIKE '%${searchVal}%'`;
          })
          .join(" OR ");
        if (conditions) where = ` WHERE (${conditions})`;
      }
      let order = "";
      if (p.sortConfig) {
        order = ` ORDER BY ${quoteCol(p.sortConfig.column)} ${p.sortConfig.direction}`;
      }
      let limitClause = ` LIMIT ${p.pageSize}`;
      let offsetClause = ` OFFSET ${p.page * p.pageSize}`;
      if (dbType === "mssql") {
        limitClause = ` OFFSET ${p.page * p.pageSize} ROWS FETCH NEXT ${p.pageSize} ROWS ONLY`;
        offsetClause = "";
      }
      const sqlQuery = `SELECT * FROM ${tableRef}${where}${order}${limitClause}${offsetClause};`;

      setLoading(true);
      setError(null);
      try {
        const [rowsRes, structRes, fkRes, countRes] = await Promise.all([
          runQuery(connectionString, sqlQuery),
          fetchTableStructure(connectionString, schema, tableName!),
          fetchTableForeignKeys(connectionString, schema, tableName!),
          runQuery(
            connectionString,
            `SELECT COUNT(*) as cnt FROM ${quoteTableRef(schema, tableName!, dbType)}${p.filterQuery ? ` WHERE ${p.filterQuery}` : ""};`,
          ),
        ]);
        if (!rowsRes.success) {
          setError(rowsRes.error || "Failed to load table widget data");
          return;
        }
        const nextResults = rowsRes.data || { rows: [], fields: [] };
        const nextStructure = structRes.success ? structRes.data || [] : [];
        const nextForeignKeys = fkRes.success ? fkRes.data || [] : [];
        setResults(nextResults);
        setStructure(nextStructure);
        setForeignKeys(nextForeignKeys);
        if (countRes.success && countRes.data?.rows?.[0]) {
          setTotalCount(Number(countRes.data.rows[0].cnt));
        } else {
          setTotalCount(nextResults.rows.length);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const rowsRes = await runQuery(connectionString, query);
      if (!rowsRes.success) {
        setError(rowsRes.error || "Failed to load table widget data");
        return;
      }
      const nextResults = rowsRes.data || { rows: [], fields: [] };
      setResults(nextResults);
      setTotalCount(nextResults.rows.length);
    } catch (e: any) {
      setError(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [connectionString, schema, tableName, customQuery, dbType]);

  useEffect(() => {
    fetchData();
  }, [
    fetchData,
    refreshKey,
    filterQuery,
    sortConfig,
    globalSearchQuery,
    globalSearchScope,
    page,
    pageSize,
  ]);

  const rows = results?.rows || [];

  const handleRefreshData = useCallback(
    async (
      _table: string,
      _schema: string,
      filter: string,
      sort: Array<{ column: string; direction: "ASC" | "DESC" }>,
    ) => {
      setFilterQuery(filter);
      if (sort.length > 0) setSortConfig(sort[0]);
      else setSortConfig(null);
      setPage(0);
    },
    [],
  );

  const refreshCurrentTab = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // fallow-ignore-next-line code-duplication
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  // fallow-ignore-next-line code-duplication
  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(0);
  }, []);

  const fieldNames = useMemo(
    () => (results?.fields || []).map((f: any) => f.name ?? f),
    [results],
  );

  const formatExportData = useCallback(
    (fields: string[], format: "json" | "csv" | "sql") => {
      if (!results?.rows?.length) return "";
      if (format === "json") {
        return JSON.stringify(results.rows, null, 2);
      }
      if (format === "csv") {
        const header = fields.join(",");
        const body = results.rows
          .map((row: any) =>
            fields
              .map((f: string) => {
                const v = row[f];
                if (v === null || v === undefined) return "";
                const s = String(v);
                return s.includes(",") || s.includes('"')
                  ? `"${s.replace(/"/g, '""')}"`
                  : s;
              })
              .join(","),
          )
          .join("\n");
        return `${header}\n${body}`;
      }
      const tableRef = tableName ? `${schema}.${tableName}` : "export";
      const cols = fields.join(", ");
      const vals = results.rows
        .map(
          (row: any) =>
            `(${fields
              .map((f: string) => {
                const v = row[f];
                if (v === null || v === undefined) return "NULL";
                if (typeof v === "number") return String(v);
                return `'${String(v).replace(/'/g, "''")}'`;
              })
              .join(", ")})`,
        )
        .join(",\n");
      return `INSERT INTO ${tableRef} (${cols}) VALUES\n${vals};`;
    },
    [results, tableName, schema],
  );

  const exportData = useCallback(
    (format: "json" | "csv" | "sql") => {
      const content = formatExportData(fieldNames, format);
      if (!content) return;
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tableName || "export"}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [formatExportData, fieldNames, tableName],
  );

  const copyData = useCallback(
    (format: "json" | "csv" | "sql") => {
      const content = formatExportData(fieldNames, format);
      if (!content) return;
      navigator.clipboard.writeText(content);
    },
    [formatExportData, fieldNames],
  );

  const handleDeleteRows = useCallback(async () => {
    if (!tableName || selectedRows.size === 0) return;
    setIsDeleting(true);
    try {
      const pkCol = structure.find(
        (c: any) => c.is_primary_key === true || c.is_primary_key === "t",
      );
      const rowsToDelete = Array.from(selectedRows)
        .map((i) => rows[i])
        .filter(Boolean);
      for (const row of rowsToDelete) {
        if (pkCol) {
          const val = row[pkCol.column_name];
          if (val !== undefined) {
            const qpk = quoteCol(pkCol.column_name);
            const qtable = quoteTableRef(schema, tableName, dbType);
            await runQuery(
              connectionString,
              `DELETE FROM ${qtable} WHERE ${qpk} = ${typeof val === "number" ? val : `'${String(val).replace(/'/g, "''")}'`};`,
            );
          }
        }
      }
      setSelectedRows(new Set());
      fetchData();
    } catch (e: any) {
      setError(e.message || "Failed to delete rows");
    } finally {
      setIsDeleting(false);
    }
  }, [
    tableName,
    selectedRows,
    structure,
    rows,
    schema,
    dbType,
    connectionString,
    fetchData,
  ]);

  const handleDuplicateRow = useCallback(
    (row: any) => {
      if (!tableName || !row) return;
      const colNames = structure
        .map((c: any) => c.column_name)
        .filter(
          (n: string) =>
            !structure.find(
              (c: any) =>
                (c.is_primary_key === true || c.is_primary_key === "t") &&
                c.column_name === n,
            ),
        );
      const qcols = colNames.map((n: string) => quoteCol(n)).join(", ");
      const vals = colNames
        .map((n: string) => {
          const v = row[n];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        })
        .join(", ");
      runQuery(
        connectionString,
        `INSERT INTO ${quoteTableRef(schema, tableName, dbType)} (${qcols}) VALUES (${vals});`,
      ).then(() => {
        fetchData();
      });
    },
    [tableName, structure, schema, dbType, connectionString, fetchData],
  );

  const handleCopyRowJSON = useCallback((row: any) => {
    if (row) navigator.clipboard.writeText(JSON.stringify(row, null, 2));
  }, []);

  const handleCopyRowCSV = useCallback(
    (row: any) => {
      if (!row || !results?.fields) return;
      const csv = fieldNames
        .map((f: string) => {
          const v = row[f];
          if (v === null || v === undefined) return "";
          const s = String(v);
          return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",");
      navigator.clipboard.writeText(csv);
    },
    [results, fieldNames],
  );

  const handleFKSelection = useCallback(async () => false, []);
  const handleFKPreview = useCallback(() => {}, []);
  const handleUpdateRow = useCallback(async () => {}, []);
  const hasChanges = useCallback(() => false, []);
  const getChangedValue = useCallback(() => null, []);

  const toggleColumn = useCallback((colName: string) => {
    setHiddenColumns((prev) =>
      prev.includes(colName)
        ? prev.filter((c) => c !== colName)
        : [...prev, colName],
    );
  }, []);

  const showAllColumns = useCallback(() => {
    setHiddenColumns([]);
  }, []);

  const supportsWholeTableSearch = dbType !== "redis" && dbType !== "mongodb";

  return (
    <div
      className="h-full min-h-0 overflow-hidden rounded-[3px] flex flex-col bg-studio-bg"
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <DataTableToolbar
        selectedRows={selectedRows}
        setSelectedRows={setSelectedRows}
        exportData={exportData}
        copyData={copyData}
        handleDeleteRows={handleDeleteRows}
        isDeleting={isDeleting}
        filterQuery={filterQuery}
        setFilterQuery={setFilterQuery}
        sortConfig={sortConfig ? [sortConfig] : []}
        setSortConfig={(config) =>
          setSortConfig(config.length > 0 ? config[0] : null)
        }
        refreshTableData={handleRefreshData}
        refreshCurrentTab={refreshCurrentTab}
        selectedTable={tableName || null}
        selectedSchema={schema}
        results={results}
        setIsInsertSheetOpen={() => {}}
        loading={loading}
        fetchingStructure={loading}
        onOpenRlsPolicies={() => {}}
        globalSearchQuery={globalSearchQuery}
        setGlobalSearchQuery={setGlobalSearchQuery}
        globalSearchScope={globalSearchScope}
        setGlobalSearchScope={setGlobalSearchScope}
        supportsWholeTableSearch={supportsWholeTableSearch}
        dbType={dbType}
        rlsEnabled={false}
        rlsPolicyCount={0}
        permissionContext={null}
        setPermissionContext={() => {}}
        postgresRoles={[]}
        supabaseAuthUsers={[]}
        loadingPermissionOptions={false}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
        onShowAllColumns={showAllColumns}
        tableStructure={structure}
      />
      <DataGrid
        results={results}
        tableStructure={structure}
        hiddenColumns={hiddenColumns}
        selectedRows={selectedRows}
        setSelectedRows={setSelectedRows}
        toggleAllSelection={() => {
          setSelectedRows((prev) =>
            prev.size === rows.length
              ? new Set()
              : new Set(rows.map((_: any, i: number) => i)),
          );
        }}
        toggleRowSelection={createRowToggleHandler(setSelectedRows)}
        getRowId={dataGridRowIdGetter}
        pendingChanges={pendingChanges}
        setPendingChanges={setPendingChanges}
        editingCell={editingCell}
        setEditingCell={setEditingCell}
        selectedCell={selectedCell}
        setSelectedCell={setSelectedCell}
        selectedColumn={selectedColumn}
        setSelectedColumn={setSelectedColumn}
        hasChanges={hasChanges}
        getChangedValue={getChangedValue}
        handleUpdateRow={handleUpdateRow}
        handleFKSelection={handleFKSelection}
        handleFKPreview={handleFKPreview}
        loading={loading}
        fetchingStructure={loading}
        error={error}
        isAddColumnSheetOpen={false}
        setIsAddColumnSheetOpen={() => {}}
        isAddingColumn={false}
        handleAddColumn={async () => {}}
        handleDeleteColumn={async () => {}}
        columnToDelete={null}
        setColumnToDelete={() => {}}
        selectedTable={tableName || null}
        selectedSchema={schema}
        sortConfig={sortConfig}
        setSortConfig={setSortConfig}
        pageSize={pageSize}
        page={page}
        totalCount={totalCount}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onDuplicateRow={handleDuplicateRow}
        onCopyRowJSON={handleCopyRowJSON}
        onCopyRowCSV={handleCopyRowCSV}
        rowSpacing={rowSpacing}
        alternatingRowColors={alternatingRowColors}
        glassmorphicHeaders={glassmorphicHeaders}
        gridAnimations={gridAnimations}
        sleekSelection={sleekSelection}
        colorizedPills={colorizedPills}
        relativeDates={relativeDates}
        richJsonInspector={richJsonInspector}
        dataBars={dataBars}
        skeletonLoaders={skeletonLoaders}
        connectionString={connectionString}
        foreignKeys={foreignKeys}
        enableColumnHover={true}
        showPaginationFooter={true}
        globalSearchQuery={globalSearchQuery}
        onFilterByCell={(columnName, value) => {
          const qcol = quoteCol(columnName);
          let filter = "";
          if (value === null || value === undefined) {
            filter = `${qcol} IS NULL`;
          } else if (typeof value === "number" && Number.isFinite(value)) {
            filter = `${qcol} = ${value}`;
          } else if (typeof value === "boolean") {
            filter =
              dbType === "mssql"
                ? `${qcol} = ${value ? 1 : 0}`
                : `${qcol} = ${value ? "TRUE" : "FALSE"}`;
          } else {
            const escaped = String(value).replace(/'/g, "''");
            filter = `${qcol} = '${escaped}'`;
          }
          setFilterQuery(filter);
          setPage(0);
        }}
      />
    </div>
  );
}

function QueryValueWidget({
  widget,
  connectionString,
  compact = false,
  fallbackMediaType,
  fallbackMediaUrl,
  refreshKey,
}: {
  widget: DashboardWidget;
  connectionString: string;
  compact?: boolean;
  fallbackMediaType?: "image" | "gif";
  fallbackMediaUrl?: string;
  refreshKey: number;
}) {
  const [value, setValue] = useState<unknown>(null);
  const { loading, error } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run metric query",
    (data) => {
      if (!data) {
        setValue(null);
        return;
      }
      const firstField = data.fields?.[0]?.name;
      const row = data.rows?.[0];
      const nextValue = firstField && row ? row[firstField] : null;
      setValue(nextValue);
    },
    [refreshKey],
  );

  const matched = (widget.conditions || []).find((condition) =>
    matchesCondition(value, condition),
  );

  return (
    <div className="h-full min-h-16 p-4 flex items-center justify-center overflow-hidden">
      {loading ? (
        <span className="text-sm text-muted-foreground">Running query...</span>
      ) : error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : matched ? (
        renderConditionAction(matched.actionType, matched.actionValue)
      ) : fallbackMediaType && fallbackMediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fallbackMediaUrl}
          alt={widget.title}
          className="max-h-full max-w-full object-contain rounded-[3px]"
        />
      ) : (
        <div
          className={
            compact
              ? "text-sm text-muted-foreground"
              : "text-sm font-semibold tracking-tight"
          }
        >
          {value === null || value === undefined ? "-" : String(value)}
        </div>
      )}
    </div>
  );
}

function QueryMetricWidget({
  widget,
  connectionString,
  refreshKey,
}: {
  widget: DashboardWidget;
  connectionString: string;
  refreshKey: number;
}) {
  const [value, setValue] = useState<unknown>(null);
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const metricOptions = useMemo(
    () => parseMetricWidgetOptions(widget.content),
    [widget.content],
  );
  const { loading, error } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run metric query",
    (data) => {
      const extracted = extractFieldsAndRow(data);
      if (!extracted) {
        setValue(null);
        setPreviousValue(null);
        return;
      }
      const { fields, row } = extracted;
      const primaryField = fields[0];
      const primaryValue = row[primaryField];
      const secondaryNumericField = fields
        .slice(1)
        .find((fieldName: string) => toNumericValue(row[fieldName]) !== null);
      const nextPreviousValue = secondaryNumericField
        ? toNumericValue(row[secondaryNumericField])
        : null;
      setValue(primaryValue);
      setPreviousValue(nextPreviousValue);
    },
    [refreshKey],
  );

  const matched = (widget.conditions || []).find((condition) =>
    matchesCondition(value, condition),
  );
  const matchedConditionColor = parseMetricConditionColor(matched?.actionValue);
  const effectiveTintColor = matchedConditionColor || metricOptions.tintColor;
  const currentNumeric = toNumericValue(value);
  const delta =
    currentNumeric !== null && previousValue !== null
      ? currentNumeric - previousValue
      : null;
  const deltaPct =
    delta !== null && previousValue !== null && previousValue !== 0
      ? (delta / Math.abs(previousValue)) * 100
      : null;

  const formattedPrimary =
    currentNumeric !== null
      ? metricOptions.valueFormat === "compact"
        ? new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 2,
          }).format(currentNumeric)
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
            currentNumeric,
          )
      : value === null || value === undefined
        ? "-"
        : String(value);
  const metricBackground = getMetricTintBackground(effectiveTintColor);

  return (
    <div
      className="h-full min-h-16 p-4 flex items-center justify-center overflow-hidden rounded-[4px]"
      style={
        metricBackground ? { backgroundImage: metricBackground } : undefined
      }
    >
      {loading ? (
        <span className="text-sm text-muted-foreground">Running query...</span>
      ) : error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : (
        <div className="w-full h-full flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div
              className="text-xs truncate"
              style={
                effectiveTintColor
                  ? { color: METRIC_TINT_TEXT_COLOR }
                  : undefined
              }
            >
              {widget.title}
            </div>
            {metricOptions.showChange && deltaPct !== null ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold tabular-nums",
                  metricOptions.colorByChange
                    ? deltaPct >= 0
                      ? "text-emerald-300 border-emerald-400/35 bg-emerald-500/10"
                      : "text-rose-300 border-rose-400/35 bg-rose-500/10"
                    : "text-muted-foreground border-studio-border/80 bg-background/40",
                )}
                style={
                  !metricOptions.colorByChange && effectiveTintColor
                    ? {
                        color: METRIC_TINT_TEXT_COLOR,
                        borderColor: "rgba(230,196,161,0.72)",
                        backgroundColor: "rgba(230,196,161,0.16)",
                      }
                    : undefined
                }
              >
                {deltaPct >= 0 ? "↗" : "↘"}{" "}
                {`${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
              </span>
            ) : null}
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm font-semibold tracking-tight tabular-nums text-center">
              {formattedPrimary}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QueryShell({
  loading,
  error,
  noData,
  noDataMessage,
  children,
}: {
  loading: boolean;
  error: string | null;
  noData?: boolean;
  noDataMessage?: string;
  children: ReactNode;
}) {
  return (
    <div className="h-full min-h-16 p-3 overflow-hidden">
      {loading ? (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          Running query...
        </div>
      ) : error ? (
        <div className="h-full flex items-center justify-center text-xs text-destructive text-center">
          {error}
        </div>
      ) : noData ? (
        <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center">
          {noDataMessage}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function QueryBarChartWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, options: chartOptions } = useChartWidgetState<BarChartWidgetOptions, SimpleChartPoint>(widget, parseBarChartWidgetOptions);
  const valueStats = useMemo(() => {
    if (!chartData.length) return { min: 0, max: 0, spread: 0 };
    const values = chartData.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, spread: max - min };
  }, [chartData]);
  const yDomain = useMemo<[number, number]>(() => {
    if (!chartData.length) return [0, 1];
    const { min, max, spread } = valueStats;
    if (spread <= 0) return [0, max * 1.05 || 1];
    if (Math.abs(spread / (Math.abs(max) || 1)) < 0.2) {
      const pad = spread * 0.2;
      return [min - pad, max + pad];
    }
    return [Math.min(0, min), max * 1.05];
  }, [chartData, valueStats]);

  const { loading, error } = useChartLoad(
    connectionString,
    widget.query,
    { limit: 50 },
    "Chart query must return at least one numeric column.",
    setChartData,
    refreshKey,
  );

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No chart data returned."
    >
      <div className="h-full min-h-36 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div className="flex-1 relative pl-5 pb-5">
          {chartOptions.yLabel ? (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
              {chartOptions.yLabel}
            </span>
          ) : null}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 6, right: 4, left: 4, bottom: 8 }}
            >
              <defs>
                <linearGradient
                  id={`bar-gradient-${widget.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#2f6fe4" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#0f1b31" stopOpacity={0.9} />
                </linearGradient>
              </defs>
              <YAxis hide domain={yDomain} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fontSize: 11, fill: "#9aa3b4" }}
              />
              <Tooltip
                allowEscapeViewBox={{ x: true, y: true }}
                cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                formatter={formatTooltipNumber}
                contentStyle={DEFAULT_TOOLTIP_CONTENT_STYLE}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#e2e8f0" }}
              />
              <Bar
                dataKey="value"
                radius={[0, 0, 0, 0]}
                maxBarSize={72}
                barSize={56}
                fill={
                  chartOptions.tintColor || `url(#bar-gradient-${widget.id})`
                }
              />
            </BarChart>
          </ResponsiveContainer>
          <WidgetXLabel label={chartOptions.xLabel} />
        </div>
      </div>
    </QueryShell>
  );
}

function QueryPatternBarChartWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, seriesKeys, setSeriesKeys, options: chartOptions } = useChartWidgetState(widget, parseBarChartWidgetOptions);
  const variant = widget.widgetType as BarPatternWidgetType;
  const isMultiSeries = BAR_PATTERN_MULTI_SERIES.has(variant);

  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run chart query",
    (data) => {
      processMultiSeriesChartData(data, setChartData, setSeriesKeys, setError, {
        errorMessage: "Chart query must return at least one numeric column.",
        seriesLimit: isMultiSeries ? 2 : 1,
        normalizeLimit: 50,
      });
    },
    [isMultiSeries, refreshKey],
  );

  const chartConfig = useMemo(
    () =>
      buildPatternChartConfig(
        seriesKeys,
        chartOptions.tintColor,
        widget.title || "Value",
      ),
    [seriesKeys, chartOptions.tintColor, widget.title],
  );
  const patternId = `${widget.widgetType}-${widget.id}-pattern`;
  const isStriped = widget.widgetType === "p-chart-3";
  const isDotted = widget.widgetType === "p-chart-4";
  const isVertical = widget.widgetType === "p-chart-12";
  const showGrid =
    widget.widgetType === "p-chart-1" || widget.widgetType === "p-chart-2";

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No chart data returned."
    >
      <div className="h-full min-h-36 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div
          className={cn("flex-1 relative", isVertical ? "pb-2" : "pl-5 pb-5")}
        >
          {!isVertical && chartOptions.yLabel ? (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
              {chartOptions.yLabel}
            </span>
          ) : null}
          <ChartContainer
            config={chartConfig}
            className="h-full w-full aspect-auto"
          >
            <BarChart
              accessibilityLayer
              data={chartData}
              layout={isVertical ? "vertical" : "horizontal"}
              margin={
                isVertical
                  ? { left: -10, right: 20 }
                  : { top: 10, right: 6, left: 4, bottom: 8 }
              }
              barCategoryGap={isVertical ? "30%" : undefined}
            >
              {(isStriped || isDotted) && seriesKeys[0] ? (
                <defs>
                  {isStriped ? (
                    <pattern
                      id={patternId}
                      patternUnits="userSpaceOnUse"
                      width="8"
                      height="8"
                    >
                      <rect
                        width="8"
                        height="8"
                        fill={`var(--color-${seriesKeys[0]})`}
                        opacity="0.1"
                      />
                      <path
                        d="M0,8 L8,0 M4,12 L12,4 M-4,4 L4,-4"
                        stroke={`var(--color-${seriesKeys[0]})`}
                        strokeWidth="1.5"
                        opacity="0.6"
                      />
                      <path
                        d="M2,10 L10,2 M6,14 L14,6 M-2,6 L6,-2"
                        stroke={`var(--color-${seriesKeys[0]})`}
                        strokeWidth="1"
                        opacity="0.3"
                      />
                    </pattern>
                  ) : (
                    <pattern
                      id={patternId}
                      x="0"
                      y="0"
                      width="5"
                      height="5"
                      patternUnits="userSpaceOnUse"
                    >
                      <rect
                        width="5"
                        height="5"
                        fill={`var(--color-${seriesKeys[0]})`}
                        opacity="0.1"
                      />
                      <circle
                        cx="5"
                        cy="5"
                        r="1.4"
                        fill={`var(--color-${seriesKeys[0]})`}
                        opacity={0.6}
                      />
                    </pattern>
                  )}
                </defs>
              ) : null}
              {showGrid ? <CartesianGrid vertical={false} /> : null}
              {isVertical ? (
                <>
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={formatAxisLabel}
                  />
                  <XAxis
                    type="number"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    hide
                  />
                </>
              ) : (
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={formatAxisLabel}
                />
              )}
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    className="min-w-40 gap-2.5"
                    labelFormatter={(value) => (
                      <div className="border-border/50 mb-0.5 flex flex-col gap-0.5 border-b pb-2">
                        <span className="text-xs font-medium">{value}</span>
                      </div>
                    )}
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-xs bg-(--color-bg)"
                            style={
                              {
                                "--color-bg": `var(--color-${name})`,
                              } as CSSProperties
                            }
                          />
                          <span className="text-muted-foreground">
                            {chartConfig[name as keyof typeof chartConfig]
                              ?.label || name}
                          </span>
                        </div>
                        <span className="text-foreground font-semibold">
                          {typeof value === "number"
                            ? value.toLocaleString()
                            : String(value)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              {seriesKeys.map((seriesKey, index) => {
                const isFirst = index === 0;
                const usesPattern = (isStriped || isDotted) && isFirst;
                return (
                  <Bar
                    key={seriesKey}
                    dataKey={seriesKey}
                    fill={
                      usesPattern
                        ? `url(#${patternId})`
                        : `var(--color-${seriesKey})`
                    }
                    stroke={
                      usesPattern ? `var(--color-${seriesKey})` : undefined
                    }
                    strokeWidth={usesPattern ? 1 : undefined}
                    radius={isVertical ? 2 : 4}
                  />
                );
              })}
            </BarChart>
          </ChartContainer>
          {!isVertical && <WidgetXLabel label={chartOptions.xLabel} />}
        </div>
      </div>
    </QueryShell>
  );
}

function QueryPatternAreaChartWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, seriesKeys, setSeriesKeys, options: areaOptions } = useChartWidgetState(widget, parseAreaChartWidgetOptions);
  const variant = widget.widgetType as AreaPatternWidgetType;
  const isMultiSeries = AREA_PATTERN_MULTI_SERIES.has(variant);

  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run chart query",
    (data) => {
      processMultiSeriesChartData(data, setChartData, setSeriesKeys, setError, {
        errorMessage:
          "Area chart query must return at least one numeric column.",
        seriesLimit: isMultiSeries ? 3 : 1,
        normalizeLimit: 120,
      });
    },
    [isMultiSeries, refreshKey],
  );

  const chartConfig = useMemo(
    () =>
      buildPatternChartConfig(
        seriesKeys,
        areaOptions.tintColor,
        widget.title || "Value",
      ),
    [seriesKeys, areaOptions.tintColor, widget.title],
  );
  const isStacked = AREA_PATTERN_STACKED.has(variant);
  const isStep = variant === "p-chart-15";
  const isComposed = variant === "p-chart-17";
  const isCrosshatch = variant === "p-chart-18";
  const isGradient = variant === "p-chart-13";
  const isStackedGradient = variant === "p-chart-14";
  const seriesToRender = seriesKeys.length ? seriesKeys : ["value"];
  const patternId = `${variant}-${widget.id}-pattern`;

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No chart data returned."
    >
      <div className="h-full min-h-36 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div className="flex-1 relative pl-5 pb-5">
          {areaOptions.yLabel ? (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
              {areaOptions.yLabel}
            </span>
          ) : null}
          <ChartContainer
            config={chartConfig}
            className="h-full w-full aspect-auto"
          >
            {isComposed ? (
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 6, left: 4, bottom: 8 }}
              >
                <defs>
                  <pattern
                    id={patternId}
                    patternUnits="userSpaceOnUse"
                    width="6"
                    height="6"
                  >
                    <rect
                      width="6"
                      height="6"
                      fill={`var(--color-${seriesToRender[0]})`}
                      opacity="0.04"
                    />
                    <path
                      d="M0,6 L6,0"
                      stroke={`var(--color-${seriesToRender[0]})`}
                      strokeWidth="0.8"
                      opacity="0.15"
                    />
                  </pattern>
                </defs>
                <ChartGridTooltip />
                <Area
                  dataKey={seriesToRender[0]}
                  type="natural"
                  fill={`url(#${patternId})`}
                  stroke="none"
                  connectNulls
                />
                <Line
                  dataKey={seriesToRender[0]}
                  type="natural"
                  stroke={`var(--color-${seriesToRender[0]})`}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            ) : (
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 6, left: 4, bottom: 8 }}
              >
                <defs>
                  {isGradient || isStackedGradient
                    ? seriesToRender.map((key) => (
                        <linearGradient
                          key={key}
                          id={`${patternId}-${key}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={`var(--color-${key})`}
                            stopOpacity={0.5}
                          />
                          <stop
                            offset="95%"
                            stopColor={`var(--color-${key})`}
                            stopOpacity={0.1}
                          />
                        </linearGradient>
                      ))
                    : null}
                  {isCrosshatch
                    ? seriesToRender.map((key) => (
                        <pattern
                          key={key}
                          id={`${patternId}-${key}`}
                          x="0"
                          y="0"
                          width="8"
                          height="8"
                          patternUnits="userSpaceOnUse"
                        >
                          <path
                            d="M0,8 L8,0"
                            stroke={`var(--color-${key})`}
                            strokeWidth="0.8"
                            opacity="0.4"
                          />
                          <path
                            d="M0,0 L8,8"
                            stroke={`var(--color-${key})`}
                            strokeWidth="0.8"
                            opacity="0.2"
                          />
                        </pattern>
                      ))
                    : null}
                  {isStep ? (
                    <pattern
                      id={patternId}
                      patternUnits="userSpaceOnUse"
                      width="5"
                      height="5"
                    >
                      <rect
                        width="5"
                        height="5"
                        fill={`var(--color-${seriesToRender[0]})`}
                        opacity="0.08"
                      />
                      <circle
                        cx="2.5"
                        cy="2.5"
                        r="1"
                        fill={`var(--color-${seriesToRender[0]})`}
                        opacity="0.5"
                      />
                    </pattern>
                  ) : null}
                </defs>
                <ChartGridTooltip />
                {seriesToRender.map((seriesKey) => {
                  const fillId = isStep
                    ? `url(#${patternId})`
                    : isCrosshatch || isGradient || isStackedGradient
                      ? `url(#${patternId}-${seriesKey})`
                      : `var(--color-${seriesKey})`;
                  return (
                    <Area
                      key={seriesKey}
                      dataKey={seriesKey}
                      type={isStep ? "stepAfter" : "natural"}
                      stackId={isStacked ? "a" : undefined}
                      fill={fillId}
                      fillOpacity={isCrosshatch ? 0.5 : 0.35}
                      stroke={`var(--color-${seriesKey})`}
                      strokeWidth={isStackedGradient ? 0.8 : 2}
                      strokeDasharray={isStackedGradient ? "3 3" : undefined}
                      dot={false}
                    />
                  );
                })}
              </AreaChart>
            )}
          </ChartContainer>
          <WidgetXLabel label={areaOptions.xLabel} />
        </div>
      </div>
    </QueryShell>
  );
}

function QueryAreaChartWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, seriesKeys, setSeriesKeys, options: areaOptions } = useChartWidgetState(widget, parseAreaChartWidgetOptions);

  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run area chart query",
    (data) => {
      if (!data) {
        setChartData([]);
        setSeriesKeys([]);
        return;
      }

      const normalized = normalizeMultiSeriesChartResult(data, { limit: 120 });
      if (
        normalized.points.length === 0 ||
        normalized.seriesKeys.length === 0
      ) {
        setError("Area chart query must return at least one numeric column.");
        setChartData([]);
        setSeriesKeys([]);
        return;
      }

      const nextSeriesKeys = normalized.seriesKeys.slice(0, 3);
      setChartData(normalized.points);
      setSeriesKeys(nextSeriesKeys);
    },
    [refreshKey],
  );

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No area chart data returned."
    >
      <div className="h-full min-h-24 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div className="flex-1 relative pl-5 pb-5">
          {areaOptions.yLabel ? (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
              {areaOptions.yLabel}
            </span>
          ) : null}
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
            >
              <WidgetAreaDefsAndAxis
                seriesKeys={seriesKeys}
                tintColor={areaOptions.tintColor}
                gradientId={(_, index) => `area-fill-${widget.id}-${index}`}
                tickFill="#7f8796"
              />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip
                formatter={formatTooltipNumber}
                labelStyle={{ color: "#94a3b8", fontSize: 12 }}
                contentStyle={DEFAULT_TOOLTIP_CONTENT_STYLE}
              />
              {seriesKeys.map((seriesKey, index) => (
                <Area
                  key={seriesKey}
                  type="monotone"
                  dataKey={seriesKey}
                  stroke={
                    index === 0 && areaOptions.tintColor
                      ? areaOptions.tintColor
                      : CHART_COLORS[index % CHART_COLORS.length]
                  }
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  fill={`url(#area-fill-${widget.id}-${index})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <WidgetXLabel label={areaOptions.xLabel} />
        </div>
      </div>
    </QueryShell>
  );
}

function QueryPieChartWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, options: pieOptions } = useChartWidgetState<PieChartWidgetOptions, SimpleChartPoint>(widget, parsePieChartWidgetOptions);

  const { loading, error } = useChartLoad(
    connectionString,
    widget.query,
    { positiveOnly: true, limit: 24 },
    "Chart query must return at least one numeric column.",
    setChartData,
    refreshKey,
  );

  const total = useMemo(
    () => chartData.reduce((sum, point) => sum + point.value, 0),
    [chartData],
  );
  const piePalette = useMemo(
    () =>
      pieOptions.tintColor
        ? buildTintPalette(pieOptions.tintColor, chartData.length)
        : CHART_COLORS,
    [pieOptions.tintColor, chartData.length],
  );

  const noPieData = chartData.length === 0 || total <= 0;

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={noPieData}
      noDataMessage="No positive numeric chart data returned."
    >
      <div className="h-full flex flex-col">
        <div className="text-sm mb-1 shrink-0" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div className="flex-1 grid grid-cols-[minmax(160px,240px)_1fr] gap-3 items-center min-h-0">
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={36}
                  outerRadius={62}
                  paddingAngle={2}
                  stroke="none"
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`${entry.label}-${index}`}
                      fill={piePalette[index % piePalette.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={formatTooltipNumber}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 overflow-auto max-h-full pr-1">
            {chartData.map((point, index) => {
              const color = piePalette[index % piePalette.length];
              const pct = (point.value / total) * 100;
              return (
                <div
                  key={`${point.label}-${point.value}`}
                  className="grid grid-cols-[auto_1fr_auto] gap-2 items-center text-xs"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-[2px]"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className="truncate text-muted-foreground"
                    title={point.label}
                  >
                    {point.label}
                  </span>
                  <span className="font-mono tabular-nums">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </QueryShell>
  );
}

function MapPreviewPanel({
  title,
  points,
  pulse,
}: {
  title: string;
  points: MapPoint[];
  pulse: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const L = await loadLeafletModule().catch(() => null);
      if (!L || cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        worldCopyJump: true,
        minZoom: 1,
      }).setView([20, 0], 2);

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          maxZoom: 19,
          subdomains: "abcd",
        },
      ).addTo(map);

      mapRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);
      // Leaflet can mount with stale dimensions when container visibility changes.
      requestAnimationFrame(() => {
        map.invalidateSize(false);
      });
    };

    init();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const updateMarkers = async () => {
      const L: typeof LeafletModule | null = await loadLeafletModule().catch(
        () => null,
      );
      if (!L || cancelled || !mapRef.current) return;

      const map = mapRef.current;
      if (!markersLayerRef.current) {
        markersLayerRef.current = L.layerGroup().addTo(map);
      } else {
        markersLayerRef.current.clearLayers();
      }

      points.forEach((point) => {
        const color = point.color || "#3b82f6";
        const icon = L.divIcon({
          className: "map-marker-icon",
          html: `
            ${pulse ? `<span class="map-marker-pulse" style="background:${color};"></span>` : ""}
            <span class="map-marker-core" style="background:${color};"></span>
          `,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        L.marker([point.lat, point.lon], { icon })
          .bindTooltip(point.label, { direction: "top", offset: [0, -8] })
          .addTo(markersLayerRef.current);
      });

      if (points.length > 0) {
        const bounds = L.latLngBounds(
          points.map((point) => [point.lat, point.lon]),
        );
        map.fitBounds(bounds.pad(0.45), { maxZoom: 5, animate: false });
      } else {
        map.setView([20, 0], 2, { animate: false });
      }
      map.invalidateSize(false);
    };

    updateMarkers();
    return () => {
      cancelled = true;
    };
  }, [points, pulse]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (map) map.invalidateSize(false);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-full rounded-[4px] border border-studio-border/80 bg-card/60 relative overflow-hidden">
      <div ref={containerRef} className="h-full w-full map-host" />
      <div className="absolute left-4 top-3 text-xs text-muted-foreground/90 font-medium z-[500] pointer-events-none">
        {title}
      </div>
    </div>
  );
}

function QueryMapWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const mapOptions = useMemo(
    () => parseMapWidgetOptions(widget.content),
    [widget.content],
  );
  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run map query",
    (data) => {
      if (!data) {
        setPoints(DEFAULT_MAP_POINTS);
        return;
      }
      const parsed = normalizeMapQueryResult(data);
      if (!parsed.length) {
        setError("Map query must return latitude and longitude columns.");
        setPoints(DEFAULT_MAP_POINTS);
        return;
      }
      setPoints(parsed);
    },
    [refreshKey],
  );

  return (
    <QueryShell loading={loading} error={error}>
      <MapPreviewPanel
        title={widget.title || "Map"}
        points={points}
        pulse={mapOptions.pulse}
      />
    </QueryShell>
  );
}

function QuerySparklineWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, options: sparklineOptions } = useChartWidgetState<SparklineWidgetOptions, SimpleChartPoint>(widget, parseSparklineWidgetOptions);

  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run sparkline query",
    (data) => {
      if (!data) {
        setChartData([]);
        return;
      }

      const points = normalizeChartQueryResult(data, { limit: 200 });
      if (points.length === 0) {
        setChartData([]);
        setError("Sparkline query must return at least one numeric column.");
        return;
      }

      setChartData(points);
    },
    [refreshKey],
  );

  const sparklineTintColor = sparklineOptions.tintColor || "#3b82f6";
  const sparklineDeltaPct =
    chartData.length >= 2 && chartData[0].value !== 0
      ? ((chartData[chartData.length - 1].value - chartData[0].value) /
          Math.abs(chartData[0].value)) *
        100
      : null;

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No sparkline data returned."
    >
      <div className="h-full min-h-24 flex flex-col">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-sm truncate" style={{ color: "#8b95a7" }}>
            {widget.title}
          </div>
          {sparklineOptions.showIncrease && sparklineDeltaPct !== null ? (
            <span className="text-xs tabular-nums text-emerald-300">
              {sparklineDeltaPct >= 0 ? "+" : ""}
              {sparklineDeltaPct.toFixed(1)}%
            </span>
          ) : null}
        </div>
        <div className="flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id={`sparkline-fill-${widget.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={sparklineTintColor}
                    stopOpacity={0.35}
                  />
                  <stop offset="100%" stopColor="#0f1b31" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip
                cursor={{ stroke: "rgba(148, 163, 184, 0.35)", strokeWidth: 1 }}
                formatter={formatTooltipNumber}
                labelStyle={{ color: "#94a3b8", fontSize: 12 }}
                contentStyle={DEFAULT_TOOLTIP_CONTENT_STYLE}
              />
              <Area
                type="linear"
                dataKey="value"
                stroke={sparklineTintColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                fill={`url(#sparkline-fill-${widget.id})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </QueryShell>
  );
}

function QueryTextWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const textOptions = useMemo(
    () => parseTextWidgetOptions(widget.content),
    [widget.content],
  );
  const { loading, error } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run text query",
    (data) => {
      if (!data) {
        setRow(null);
        return;
      }
      const nextRow = (data.rows?.[0] || null) as Record<
        string,
        unknown
      > | null;
      setRow(nextRow);
    },
    [refreshKey],
  );

  const resolvedText = renderTextTemplate(textOptions.template, row);

  return (
    <div
      className="h-full min-h-16 p-4 overflow-hidden flex flex-col"
      style={
        textOptions.tintColor
          ? { backgroundImage: getMetricTintBackground(textOptions.tintColor) }
          : undefined
      }
    >
      <div
        className="text-sm mb-2 truncate"
        style={{
          color: textOptions.tintColor ? METRIC_TINT_TEXT_COLOR : "#8b95a7",
        }}
      >
        {widget.title}
      </div>
      <div className="flex-1 flex items-center justify-center text-center">
        {loading ? (
          <span className="text-sm text-muted-foreground">
            Running query...
          </span>
        ) : error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : (
          <span className="font-space text-sm leading-snug font-semibold whitespace-pre-wrap break-words">
            {resolvedText || textOptions.template || "No text configured"}
          </span>
        )}
      </div>
    </div>
  );
}

function QueryProgressWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const [value, setValue] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run progress query",
    (data) => {
      const extracted = extractFieldsAndRow(data);
      if (!extracted) {
        setValue(null);
        setTarget(null);
        return;
      }
      const { fields, row } = extracted;
      const numericValues = fields
        .map((fieldName: string) => toNumericValue(row[fieldName]))
        .filter(
          (fieldValue: number | null): fieldValue is number =>
            fieldValue !== null,
        );
      if (numericValues.length === 0) {
        setError("Progress query must return at least one numeric value.");
        setValue(null);
        setTarget(null);
        return;
      }
      const nextValue = numericValues[0];
      const nextTarget = numericValues.length > 1 ? numericValues[1] : null;
      setValue(nextValue);
      setTarget(nextTarget);
    },
    [refreshKey],
  );

  const matched = (widget.conditions || []).find((condition) =>
    matchesCondition(value, condition),
  );
  const percent = useMemo(() => {
    if (value === null) return 0;
    if (target !== null && target > 0) return (value / target) * 100;
    return value;
  }, [target, value]);
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className="h-full min-h-16 p-4 flex flex-col justify-center gap-3 overflow-hidden">
      {loading ? (
        <span className="text-sm text-muted-foreground">Running query...</span>
      ) : error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : matched ? (
        <div className="h-full flex items-center justify-center">
          {renderConditionAction(matched.actionType, matched.actionValue)}
        </div>
      ) : value === null ? (
        <span className="text-sm text-muted-foreground">
          No progress data returned.
        </span>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2">
            <span className="text-xs text-muted-foreground truncate">
              {widget.title}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {clampedPercent.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-lg bg-muted/40 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500 ease-out"
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {target !== null
              ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} / ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(target)}`
              : new Intl.NumberFormat("en-US", {
                  maximumFractionDigits: 2,
                }).format(value)}
          </div>
        </>
      )}
    </div>
  );
}

function QueryMetricBarWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, options: chartOptions } = useChartWidgetState<BarChartWidgetOptions, SimpleChartPoint>(widget, parseBarChartWidgetOptions);
  const [metricValue, setMetricValue] = useState<number | null>(null);

  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run chart query",
    (data) => {
      if (!data) {
        setChartData([]);
        setMetricValue(null);
        return;
      }
      const points = normalizeChartQueryResult(data, { limit: 60 });
      if (points.length === 0) {
        setError("Query must return at least one numeric column.");
        setChartData([]);
        setMetricValue(null);
        return;
      }
      setChartData(points);
      const lastVal = points[points.length - 1]?.value ?? null;
      setMetricValue(lastVal);
    },
    [refreshKey],
  );

  const tintColor = chartOptions.tintColor || "#3b82f6";
  const formattedValue =
    metricValue !== null
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 2,
        }).format(metricValue)
      : "-";

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No chart data returned."
    >
      <div className="h-full min-h-36 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div
          className="text-3xl font-bold tabular-nums mb-2"
          style={{ color: tintColor }}
        >
          {formattedValue}
        </div>
        <div className="flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 2, right: 4, left: -20, bottom: 0 }}
              barCategoryGap="20%"
            >
              <XAxis
                dataKey="label"
                tick={{ fill: "#7f8796", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
                formatter={formatTooltipNumber}
                labelStyle={{ color: "#94a3b8", fontSize: 12 }}
                contentStyle={DEFAULT_TOOLTIP_CONTENT_STYLE}
              />
              <Bar dataKey="value" fill={tintColor} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </QueryShell>
  );
}

function QueryDotMatrixWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, options: chartOptions } = useChartWidgetState<BarChartWidgetOptions, SimpleChartPoint>(widget, parseBarChartWidgetOptions);

  const { loading, error } = useChartLoad(
    connectionString,
    widget.query,
    { limit: 200 },
    "Query must return at least one numeric column.",
    setChartData,
    refreshKey,
  );

  const tintColor = chartOptions.tintColor || "#3b82f6";
  const maxVal = chartData.length ? Math.max(...chartData.map((p) => p.value)) : 1;
  const ROWS = 8;
  const cols = chartData.length;

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No data returned."
    >
      <div className="h-full min-h-36 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        <div className="flex-1 overflow-hidden">
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${cols * 14} ${ROWS * 14}`}
            preserveAspectRatio="xMinYMid meet"
          >
            <DotMatrix data={chartData} maxVal={maxVal} rows={ROWS} cellSize={14} offset={7} radius={4} tintColor={tintColor} fillOpacity={0.9} />
          </svg>
        </div>
        {chartOptions.xLabel ? (
          <div
            className="text-xs text-center mt-1"
            style={{ color: "#7f8796" }}
          >
            {chartOptions.xLabel}
          </div>
        ) : null}
      </div>
    </QueryShell>
  );
}

function QueryStackedBarChartWidget({
  widget,
  connectionString,
  refreshKey,
}: WidgetQueryProps) {
  const { chartData, setChartData, seriesKeys, setSeriesKeys, options: chartOptions } = useChartWidgetState(widget, parseBarChartWidgetOptions);

  const { loading, error, setError } = useWidgetChartLoad(
    connectionString,
    widget.query,
    "Failed to run chart query",
    (data) => {
      processMultiSeriesChartData(data, setChartData, setSeriesKeys, setError, {
        errorMessage: "Chart query must return at least one numeric column.",
        seriesLimit: 6,
        normalizeLimit: 60,
      });
    },
    [refreshKey],
  );

  const chartConfig = useMemo(
    () =>
      buildPatternChartConfig(
        seriesKeys,
        chartOptions.tintColor,
        widget.title || "Value",
      ),
    [seriesKeys, chartOptions.tintColor, widget.title],
  );

  return (
    <QueryShell
      loading={loading}
      error={error}
      noData={chartData.length === 0}
      noDataMessage="No chart data returned."
    >
      <div className="h-full min-h-36 flex flex-col">
        <div className="text-sm mb-1" style={{ color: "#8b95a7" }}>
          {widget.title}
        </div>
        {seriesKeys.length > 1 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
            {seriesKeys.map((key, index) => (
              <span key={key} className="flex items-center gap-1 text-xs" style={{ color: "#8b95a7" }}>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{
                    background: BAR_PATTERN_COLORS[index % BAR_PATTERN_COLORS.length],
                  }}
                />
                {formatSeriesLabel(key)}
              </span>
            ))}
          </div>
        )}
        <div className="flex-1 relative pl-5 pb-5">
          <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
            <BarChart
              accessibilityLayer
              data={chartData}
              margin={{ top: 4, right: 6, left: 4, bottom: 8 }}
              barCategoryGap="25%"
            >
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.1)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#7f8796", fontSize: 11 }}
                tickFormatter={formatAxisLabel}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#7f8796", fontSize: 11 }}
                width={38}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              {seriesKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="stack"
                  fill={BAR_PATTERN_COLORS[index % BAR_PATTERN_COLORS.length]}
                  radius={index === seriesKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </QueryShell>
  );
}

function GenericWidget({ widget }: { widget: DashboardWidget }) {
  if (widget.widgetType === "text") {
    return (
      <div className="h-full min-h-16 p-4 text-sm">
        {widget.content || "No text configured"}
      </div>
    );
  }

  if (widget.widgetType === "image" || widget.widgetType === "gif") {
    return (
      <div className="h-full min-h-16 p-3 flex items-center justify-center">
        {widget.content ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={widget.content}
            alt={widget.title}
            className="max-h-full max-w-full object-contain rounded-[3px]"
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            No media URL configured
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="h-full min-h-16 p-4 flex items-center justify-center text-muted-foreground text-sm">
      {WIDGET_TYPE_OPTIONS.find((option) => option.value === widget.widgetType)
        ?.label || widget.widgetType}{" "}
      widget preview coming soon
    </div>
  );
}

const RunQuerySection = ({
  onRun,
  loading,
  error,
  lintError,
  footerExtra,
  editor,
  children,
}: {
  onRun: () => void;
  loading?: boolean;
  error: string | null;
  lintError?: string | null;
  footerExtra?: ReactNode;
  editor: ReactNode;
  children?: ReactNode;
}) => (
  <div className="rounded-[6px] border border-studio-border/80 overflow-hidden">
    {children}
    {editor}
    <div className="border-t border-studio-border/80 p-3 flex items-center gap-2">
      <Button size="sm" onClick={onRun} disabled={!!loading || !!lintError}>
        <Play className="w-3.5 h-3.5" />
        {loading ? "Running..." : "Run Query"}
      </Button>
      {footerExtra}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  </div>
);

function DotMatrix({ data, maxVal, rows, cellSize, offset, radius, tintColor, fillOpacity }: {
  data: { value: number }[];
  maxVal: number;
  rows: number;
  cellSize: number;
  offset: number;
  radius: number;
  tintColor: string;
  fillOpacity: number;
}) {
  return data.map((point, colIdx) => {
    const filledRows = Math.round((point.value / maxVal) * rows);
    return Array.from({ length: rows }, (_, rowIdx) => {
      const filled = rows - 1 - rowIdx < filledRows;
      return (
        <circle
          key={`${colIdx}-${rowIdx}`}
          cx={colIdx * cellSize + offset}
          cy={rowIdx * cellSize + offset}
          r={radius}
          fill={filled ? tintColor : "currentColor"}
          opacity={filled ? fillOpacity : 0.12}
        />
      );
    });
  });
}

export function DashboardView({
  dashboard,
  onEditWithAi,
  onRefresh,
  isLocked,
  onToggleLock,
  addDashboardWidgetFromBounds,
  updateDashboardWidget,
  removeDashboardWidget,
  applyDashboardWidgetLayout,
  tables,
  selectedSchema,
  connectionString,
  editorThemeId = "auto",
  appEditorTheme = null,
  vimMode = false,
}: DashboardViewProps) {
  const { resolvedTheme } = useTheme();
  const dbType = useMemo(
    () => detectConnectionDbType(connectionString),
    [connectionString],
  );
  const fallbackSchemaForDb =
    (dbType === "postgres" || dbType === "supabase-mgmt")
      ? "public"
      : dbType === "mssql"
        ? "dbo"
        : getDatabaseFromConnectionString(connectionString);
  const resolvedEditorThemeId = resolveEditorThemeId(
    editorThemeId,
    resolvedTheme || "light",
    appEditorTheme?.id,
  );
  const monacoRef = useRef<any>(null);
  const vimDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draftRect, setDraftRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);

  const handleRefresh = useCallback(() => {
    console.log(
      "[Dashboard] Manual refresh triggered at",
      new Date().toISOString(),
    );
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
    onRefresh();
    refreshTimerRef.current = window.setTimeout(
      () => setIsRefreshing(false),
      2000,
    );
  }, [onRefresh]);

  const [configOpen, setConfigOpen] = useState(false);
  const [configWidgetId, setConfigWidgetId] = useState<string | null>(null);
  const [widgetNameInput, setWidgetNameInput] = useState("");
  const [selectedWidgetType, setSelectedWidgetType] =
    useState<DashboardWidgetType>("metric");
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [widgetQueryInput, setWidgetQueryInput] = useState("SELECT 1;");
  const [widgetContentInput, setWidgetContentInput] = useState("");

  useEffect(() => {
    if (!monacoRef.current) return;
    if (!appEditorTheme) return;
    registerCustomMonacoThemes(monacoRef.current, [appEditorTheme]);
    monacoRef.current.editor.setTheme(resolvedEditorThemeId);
  }, [appEditorTheme, resolvedEditorThemeId]);
  const [conditionsInput, setConditionsInput] = useState<DashboardCondition[]>(
    [],
  );
  const [queryPreview, setQueryPreview] = useState<string>("");
  const [queryPreviewValue, setQueryPreviewValue] = useState<unknown>(null);
  const [queryPreviewDeltaPct, setQueryPreviewDeltaPct] = useState<
    number | null
  >(null);
  const [queryPreviewError, setQueryPreviewError] = useState<string>("");
  const [queryPreviewRows, setQueryPreviewRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [queryPreviewFields, setQueryPreviewFields] = useState<string[]>([]);
  const [tablePreviewResults, setTablePreviewResults] =
    useState<TablePreviewResults>(DEFAULT_TABLE_PREVIEW_RESULTS);
  const [tablePreviewSelectedRows, setTablePreviewSelectedRows] = useState<
    Set<number>
  >(new Set());
  const [tablePreviewError, setTablePreviewError] = useState<string>("");
  const [tablePreviewLoading, setTablePreviewLoading] = useState(false);
  const [metricValueFormat, setMetricValueFormat] = useState<
    "number" | "compact"
  >("number");
  const [metricTintColor, setMetricTintColor] = useState<string | null>(
    DEFAULT_METRIC_OPTIONS.tintColor,
  );
  const [metricShowChange, setMetricShowChange] = useState(true);
  const [metricColorByChange, setMetricColorByChange] = useState(false);
  const [barChartTintColor, setBarChartTintColor] = useState<string | null>(
    DEFAULT_BAR_CHART_OPTIONS.tintColor,
  );
  const [barChartXLabel, setBarChartXLabel] = useState(
    DEFAULT_BAR_CHART_OPTIONS.xLabel,
  );
  const [barChartYLabel, setBarChartYLabel] = useState(
    DEFAULT_BAR_CHART_OPTIONS.yLabel,
  );
  const [barChartPreviewData, setBarChartPreviewData] = useState<
    SimpleChartPoint[]
  >(DEFAULT_BAR_CHART_PREVIEW_DATA);
  const [barChartPreviewSeriesData, setBarChartPreviewSeriesData] = useState<
    MultiSeriesChartPoint[]
  >(DEFAULT_BAR_CHART_MULTI_SERIES_PREVIEW);
  const [barChartPreviewSeriesKeys, setBarChartPreviewSeriesKeys] = useState<
    string[]
  >(["desktop", "mobile"]);
  const [barChartPreviewError, setBarChartPreviewError] = useState("");
  const [areaChartTintColor, setAreaChartTintColor] = useState<string | null>(
    DEFAULT_AREA_CHART_OPTIONS.tintColor,
  );
  const [areaChartXLabel, setAreaChartXLabel] = useState(
    DEFAULT_AREA_CHART_OPTIONS.xLabel,
  );
  const [areaChartYLabel, setAreaChartYLabel] = useState(
    DEFAULT_AREA_CHART_OPTIONS.yLabel,
  );
  const [areaChartPreviewData, setAreaChartPreviewData] = useState<
    MultiSeriesChartPoint[]
  >(DEFAULT_AREA_CHART_PREVIEW_DATA);
  const [areaChartPreviewSeriesKeys, setAreaChartPreviewSeriesKeys] = useState<
    string[]
  >(["products", "baseline"]);
  const [areaChartPreviewError, setAreaChartPreviewError] = useState("");
  const [sparklineTintColor, setSparklineTintColor] = useState<string | null>(
    DEFAULT_SPARKLINE_WIDGET_OPTIONS.tintColor,
  );
  const [sparklineShowIncrease, setSparklineShowIncrease] = useState(
    DEFAULT_SPARKLINE_WIDGET_OPTIONS.showIncrease,
  );
  const [sparklinePreviewData, setSparklinePreviewData] = useState<
    SimpleChartPoint[]
  >(DEFAULT_SPARKLINE_PREVIEW_DATA);
  const [sparklinePreviewError, setSparklinePreviewError] = useState("");
  const [textTintColor, setTextTintColor] = useState<string | null>(
    DEFAULT_TEXT_WIDGET_OPTIONS.tintColor,
  );
  const [textPreviewRow, setTextPreviewRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [textPreviewError, setTextPreviewError] = useState("");
  const [pieChartTintColor, setPieChartTintColor] = useState<string | null>(
    DEFAULT_PIE_CHART_OPTIONS.tintColor,
  );
  const [pieChartPreviewData, setPieChartPreviewData] = useState<
    SimpleChartPoint[]
  >([
    { label: "Category A", value: 30 },
    { label: "Category B", value: 22 },
    { label: "Category C", value: 20 },
    { label: "Category D", value: 18 },
    { label: "Category E", value: 10 },
  ]);
  const [pieChartPreviewError, setPieChartPreviewError] = useState("");
  const [mapPulse, setMapPulse] = useState(DEFAULT_MAP_WIDGET_OPTIONS.pulse);
  const [mapPreviewPoints, setMapPreviewPoints] =
    useState<MapPoint[]>(DEFAULT_MAP_POINTS);
  const [mapPreviewError, setMapPreviewError] = useState("");
  const [activeTransform, setActiveTransform] =
    useState<ActiveWidgetTransform | null>(null);
  const [liveWidgetDims, setLiveWidgetDims] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const widgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setWidgetRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      widgetRefs.current.set(id, el);
    } else {
      widgetRefs.current.delete(id);
    }
  }, []);

  const configWidget = useMemo(
    () => dashboard?.widgets.find((w) => w.id === configWidgetId) || null,
    [dashboard, configWidgetId],
  );

  const getPointInCanvas = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isLocked || activeTransform) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const point = getPointInCanvas(event.clientX, event.clientY);
    if (!point) return;
    const start = { x: snapPosition(point.x), y: snapPosition(point.y) };
    setDragStart(start);
    setDraftRect({ x: start.x, y: start.y, width: 0, height: 0 });
    setIsDrawing(true);
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    event.preventDefault();
    const point = getPointInCanvas(event.clientX, event.clientY);
    if (!point) return;

    const current = { x: snapPosition(point.x), y: snapPosition(point.y) };
    const x = Math.min(dragStart.x, current.x);
    const y = Math.min(dragStart.y, current.y);
    const width = Math.abs(current.x - dragStart.x);
    const height = Math.abs(current.y - dragStart.y);
    setDraftRect({ x, y, width, height });
  };

  const finalizeDraftWidget = () => {
    if (!dashboard || !draftRect) {
      setDragStart(null);
      setDraftRect(null);
      setIsDrawing(false);
      return;
    }

    const snapped = {
      x: snapPosition(draftRect.x),
      y: snapPosition(draftRect.y),
      width: snapSize(draftRect.width),
      height: snapSize(draftRect.height),
    };
    if (
      draftRect.width >= DASHBOARD_MIN_SIZE &&
      draftRect.height >= DASHBOARD_MIN_SIZE
    ) {
      addDashboardWidgetFromBounds(dashboard.id, snapped, "query");
    }

    setDragStart(null);
    setDraftRect(null);
    setIsDrawing(false);
  };

  const beginWidgetTransform = (
    event: React.MouseEvent,
    widget: DashboardWidget,
    mode: "move" | "resize",
  ) => {
    if (isLocked) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveTransform({
      widgetId: widget.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initialX: widget.x,
      initialY: widget.y,
      initialWidth: widget.width,
      initialHeight: widget.height,
    });
  };

  const beginWidgetMove = (event: React.MouseEvent, widget: DashboardWidget) =>
    beginWidgetTransform(event, widget, "move");

  const beginWidgetResize = (event: React.MouseEvent, widget: DashboardWidget) =>
    beginWidgetTransform(event, widget, "resize");

  useEffect(() => {
    if (!activeTransform || !dashboard) return;

    const {
      widgetId,
      mode,
      startX,
      startY,
      initialX,
      initialY,
      initialWidth,
      initialHeight,
    } = activeTransform;

    let pendingEvent: MouseEvent | null = null;
    let rafId: number | null = null;

    const handleMove = (event: MouseEvent) => {
      pendingEvent = event;
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        rafId = null;
        const evt = pendingEvent;
        pendingEvent = null;
        if (!evt) return;

        const deltaX = evt.clientX - startX;
        const deltaY = evt.clientY - startY;

        const el = widgetRefs.current.get(widgetId);
        if (!el) return;

        if (mode === "move") {
          el.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.02)`;
          el.style.boxShadow = "0 8px 32px rgba(0,0,0,0.35)";
          el.style.zIndex = "50";
          el.style.willChange = "transform";
        } else {
          const newW = Math.max(DASHBOARD_MIN_SIZE, initialWidth + deltaX);
          const newH = Math.max(DASHBOARD_MIN_SIZE, initialHeight + deltaY);
          el.style.width = `${newW - WIDGET_GUTTER}px`;
          el.style.height = `${newH - WIDGET_GUTTER}px`;
          el.style.boxShadow = "0 8px 32px rgba(0,0,0,0.35)";
          el.style.zIndex = "50";
          el.style.willChange = "transform, width, height";
          setLiveWidgetDims((prev) => ({
            ...prev,
            [widgetId]: { width: newW, height: newH },
          }));
        }
      });
    };

    const handleUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      const el = widgetRefs.current.get(widgetId);
      const candidate = dashboard.widgets.find((w) => w.id === widgetId);

      let finalWidget: DashboardWidget | null = null;

      if (el) {
        if (mode === "move") {
          let dx = 0;
          let dy = 0;
          const match = el.style.transform.match(
            /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/,
          );
          if (match) {
            dx = parseFloat(match[1]);
            dy = parseFloat(match[2]);
          }
          const newX = snapPosition(initialX + dx);
          const newY = snapPosition(initialY + dy);
          finalWidget = candidate ? { ...candidate, x: newX, y: newY } : null;
          el.style.transform = "";
        } else {
          const rawW = el.style.width
            ? parseFloat(el.style.width) + WIDGET_GUTTER
            : initialWidth;
          const rawH = el.style.height
            ? parseFloat(el.style.height) + WIDGET_GUTTER
            : initialHeight;
          const newW = snapSize(rawW);
          const newH = snapSize(rawH);
          finalWidget = candidate
            ? { ...candidate, width: newW, height: newH }
            : null;
          el.style.width = `${newW - WIDGET_GUTTER}px`;
          el.style.height = `${newH - WIDGET_GUTTER}px`;
          el.style.transform = "";
        }
        el.style.boxShadow = "";
        el.style.zIndex = "";
        el.style.willChange = "";
      }

      if (
        finalWidget &&
        hasSpaceForWidget(dashboard.widgets, widgetId, finalWidget)
      ) {
        const nextWidgets = dashboard.widgets.map((w) =>
          w.id === widgetId ? finalWidget! : w,
        );
        applyDashboardWidgetLayout(dashboard.id, nextWidgets);
      }

      setActiveTransform(null);
      setLiveWidgetDims({});
    };

    const previousCursor = document.body.style.cursor;
    preventTextSelection();
    document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
      allowTextSelection();
      document.body.style.cursor = previousCursor;
    };
  }, [activeTransform, dashboard?.id, applyDashboardWidgetLayout]);

  const openWidgetConfigurator = (widgetId: string) => {
    if (!dashboard) return;
    const widget = dashboard.widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    setConfigWidgetId(widgetId);
    setWidgetNameInput(widget.title || "");
    setSelectedWidgetType(
      widget.widgetType === "empty" ? "metric" : widget.widgetType,
    );
    setSelectedTable(widget.tableName || tables[0] || "");
    setWidgetQueryInput(
      widget.query ||
        (widget.widgetType === "table"
          ? selectWithLimit(widget.tableName || "table", 100, dbType)
          : "SELECT 1;"),
    );
    const textOptions = parseTextWidgetOptions(widget.content);
    setWidgetContentInput(
      widget.widgetType === "text"
        ? textOptions.template
        : widget.content || "",
    );
    const metricOptions = parseMetricWidgetOptions(widget.content);
    const barChartOptions = parseBarChartWidgetOptions(widget.content);
    const areaChartOptions = parseAreaChartWidgetOptions(widget.content);
    const sparklineOptions = parseSparklineWidgetOptions(widget.content);
    const pieChartOptions = parsePieChartWidgetOptions(widget.content);
    const mapOptions = parseMapWidgetOptions(widget.content);
    setMetricValueFormat(metricOptions.valueFormat);
    setMetricTintColor(metricOptions.tintColor);
    setMetricShowChange(metricOptions.showChange);
    setMetricColorByChange(metricOptions.colorByChange);
    setBarChartTintColor(barChartOptions.tintColor);
    setBarChartXLabel(barChartOptions.xLabel);
    setBarChartYLabel(barChartOptions.yLabel);
    setBarChartPreviewData(DEFAULT_BAR_CHART_PREVIEW_DATA);
    setBarChartPreviewSeriesData(DEFAULT_BAR_CHART_MULTI_SERIES_PREVIEW);
    setBarChartPreviewSeriesKeys(["desktop", "mobile"]);
    setBarChartPreviewError("");
    setAreaChartTintColor(areaChartOptions.tintColor);
    setAreaChartXLabel(areaChartOptions.xLabel);
    setAreaChartYLabel(areaChartOptions.yLabel);
    setAreaChartPreviewData(DEFAULT_AREA_CHART_PREVIEW_DATA);
    setAreaChartPreviewSeriesKeys(["products", "baseline"]);
    setAreaChartPreviewError("");
    setSparklineTintColor(sparklineOptions.tintColor);
    setSparklineShowIncrease(sparklineOptions.showIncrease);
    setSparklinePreviewData(DEFAULT_SPARKLINE_PREVIEW_DATA);
    setSparklinePreviewError("");
    setTextTintColor(textOptions.tintColor);
    setTextPreviewRow(null);
    setTextPreviewError("");
    setPieChartTintColor(pieChartOptions.tintColor);
    setPieChartPreviewData([
      { label: "Category A", value: 30 },
      { label: "Category B", value: 22 },
      { label: "Category C", value: 20 },
      { label: "Category D", value: 18 },
      { label: "Category E", value: 10 },
    ]);
    setPieChartPreviewError("");
    setMapPulse(mapOptions.pulse);
    setMapPreviewPoints(DEFAULT_MAP_POINTS);
    setMapPreviewError("");
    setConditionsInput(widget.conditions || []);
    setQueryPreview("");
    setQueryPreviewValue(null);
    setQueryPreviewDeltaPct(null);
    setQueryPreviewError("");
    setQueryPreviewRows([]);
    setQueryPreviewFields([]);
    setTablePreviewResults(DEFAULT_TABLE_PREVIEW_RESULTS);
    setTablePreviewSelectedRows(new Set());
    setTablePreviewError("");
    setTablePreviewLoading(false);
    setConfigOpen(true);
  };

  const runQueryPreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setQueryPreview("");
      setQueryPreviewValue(null);
      setQueryPreviewDeltaPct(null);
      setQueryPreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setQueryPreview("");
      setQueryPreviewValue(null);
      setQueryPreviewDeltaPct(null);
      setQueryPreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const fields =
      res.data.fields?.map((field: { name: string }) => field.name) || [];
    const row = res.data.rows?.[0];
    const firstField = fields[0];
    const firstValue = firstField && row ? row[firstField] : null;
    const numericValues = row
      ? fields
          .map((fieldName: string) => toNumericValue(row[fieldName]))
          .filter((item: number | null): item is number => item !== null)
      : [];
    const current = numericValues[0] ?? null;
    const previous = numericValues[1] ?? null;
    const deltaPct =
      current !== null && previous !== null && previous !== 0
        ? ((current - previous) / Math.abs(previous)) * 100
        : null;
    setQueryPreviewValue(firstValue);
    setQueryPreview(
      firstValue === null || firstValue === undefined
        ? "null"
        : String(firstValue),
    );
    setQueryPreviewDeltaPct(deltaPct);
    setQueryPreviewError("");
    setQueryPreviewFields(fields);
    setQueryPreviewRows(
      Array.isArray(res.data.rows)
        ? (res.data.rows as Array<Record<string, unknown>>)
        : [],
    );
  };

  const runBarChartPreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setBarChartPreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setBarChartPreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const isPatternMulti =
      (isBarPatternWidgetType(selectedWidgetType) &&
        BAR_PATTERN_MULTI_SERIES.has(selectedWidgetType)) ||
      isStackedBarWidgetType(selectedWidgetType);
    if (isPatternMulti) {
      const normalized = normalizeMultiSeriesChartResult(res.data, {
        limit: 12,
      });
      if (!normalized.points.length || !normalized.seriesKeys.length) {
        setBarChartPreviewError(
          "Bar chart query must return at least one numeric column.",
        );
        setResultPreviewFromData(res.data);
        return;
      }
      setBarChartPreviewSeriesData(normalized.points);
      const seriesLimit = isStackedBarWidgetType(selectedWidgetType) ? 6 : 2;
      setBarChartPreviewSeriesKeys(normalized.seriesKeys.slice(0, seriesLimit));
      setBarChartPreviewError("");
      setResultPreviewFromData(res.data);
      return;
    }
    const points = normalizeChartQueryResult(res.data, { limit: 12 });
    if (!points.length) {
      setBarChartPreviewError(
        "Bar chart query must return at least one numeric column.",
      );
      setResultPreviewFromData(res.data);
      return;
    }
    setBarChartPreviewData(points);
    setBarChartPreviewSeriesData(
      points.map((point) => ({ label: point.label, value: point.value })),
    );
    setBarChartPreviewSeriesKeys(["value"]);
    setBarChartPreviewError("");
    setResultPreviewFromData(res.data);
  };

  const runTablePreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setTablePreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    try {
      setTablePreviewLoading(true);
      const res = await runQuery(connectionString, query);
      if (!res.success || !res.data) {
        setTablePreviewError(res.error || "Failed to run query.");
        setQueryPreviewRows([]);
        setQueryPreviewFields([]);
        return;
      }
      const normalized = normalizeTablePreviewResult(res.data);
      setTablePreviewResults(normalized);
      setTablePreviewSelectedRows(new Set());
      setTablePreviewError("");
      setResultPreviewFromData(res.data);
    } finally {
      setTablePreviewLoading(false);
    }
  };

  const runAreaChartPreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setAreaChartPreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setAreaChartPreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const normalized = normalizeMultiSeriesChartResult(res.data, {
      limit: 120,
    });
    if (normalized.points.length === 0 || normalized.seriesKeys.length === 0) {
      setAreaChartPreviewError(
        "Area chart query must return at least one numeric column.",
      );
      setResultPreviewFromData(res.data);
      return;
    }
    setAreaChartPreviewData(normalized.points);
    const isSingleSeriesPattern =
      isAreaPatternWidgetType(selectedWidgetType) &&
      !AREA_PATTERN_MULTI_SERIES.has(selectedWidgetType);
    setAreaChartPreviewSeriesKeys(
      normalized.seriesKeys.slice(0, isSingleSeriesPattern ? 1 : 2),
    );
    setAreaChartPreviewError("");
    setResultPreviewFromData(res.data);
  };

  const runSparklinePreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setSparklinePreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setSparklinePreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const points = normalizeChartQueryResult(res.data, { limit: 200 });
    if (!points.length) {
      setSparklinePreviewError(
        "Sparkline query must return at least one numeric column.",
      );
      setResultPreviewFromData(res.data);
      return;
    }
    setSparklinePreviewData(points);
    setSparklinePreviewError("");
    setResultPreviewFromData(res.data);
  };

  const runTextPreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setTextPreviewRow(null);
      setTextPreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setTextPreviewRow(null);
      setTextPreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    setTextPreviewRow(
      (res.data.rows?.[0] || null) as Record<string, unknown> | null,
    );
    setTextPreviewError("");
    setResultPreviewFromData(res.data);
  };

  const runPieChartPreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setPieChartPreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setPieChartPreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const points = normalizeChartQueryResult(res.data, {
      positiveOnly: true,
      limit: 10,
    });
    if (!points.length) {
      setPieChartPreviewError(
        "Pie chart query must return at least one positive numeric column.",
      );
      setResultPreviewFromData(res.data);
      return;
    }
    setPieChartPreviewData(points);
    setPieChartPreviewError("");
    setResultPreviewFromData(res.data);
  };

  const runMapPreviewAction = async () => {
    const query = widgetQueryInput.trim();
    if (!query) {
      setMapPreviewError("Enter a query first.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const res = await runQuery(connectionString, query);
    if (!res.success || !res.data) {
      setMapPreviewError(res.error || "Failed to run query.");
      setQueryPreviewRows([]);
      setQueryPreviewFields([]);
      return;
    }
    const parsed = normalizeMapQueryResult(res.data);
    if (!parsed.length) {
      setMapPreviewError(
        "Map query must return latitude and longitude columns.",
      );
      setResultPreviewFromData(res.data);
      return;
    }
    setMapPreviewPoints(parsed);
    setMapPreviewError("");
    setResultPreviewFromData(res.data);
  };

  const conditionActionType = useMemo(
    () => getConditionActionTypeForWidget(selectedWidgetType),
    [selectedWidgetType],
  );
  const conditionActionTypeLabel = CONDITION_ACTION_OPTIONS.find(
    (option) => option.value === conditionActionType,
  )?.label;

  useEffect(() => {
    setConditionsInput((prev) =>
      prev.map((condition) =>
        condition.actionType === conditionActionType
          ? condition
          : { ...condition, actionType: conditionActionType },
      ),
    );
  }, [conditionActionType]);

  useEffect(() => {
    if (selectedWidgetType !== "table") return;
    if (!selectedTable) return;
    if (!widgetQueryInput.trim()) {
      setWidgetQueryInput(selectWithLimit(selectedTable, 100, dbType));
    }
  }, [selectedWidgetType, selectedTable]);

  const addConditionRow = () => {
    setConditionsInput((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2, 10),
        operator: "equals",
        value: "",
        actionType: conditionActionType,
        actionValue: "",
      },
    ]);
  };

  const handleWidgetTypeChange = (value: DashboardWidgetType) => {
    if (value === "text" && selectedWidgetType !== "text") {
      const textOptions = parseTextWidgetOptions(widgetContentInput);
      setWidgetContentInput(textOptions.template);
      setTextTintColor(textOptions.tintColor);
    }
    setSelectedWidgetType(value);
  };

  const updateConditionRow = (
    id: string,
    updates: Partial<DashboardCondition>,
  ) => {
    setConditionsInput((prev) =>
      prev.map((condition) =>
        condition.id === id ? { ...condition, ...updates } : condition,
      ),
    );
  };

  const removeConditionRow = (id: string) => {
    setConditionsInput((prev) =>
      prev.filter((condition) => condition.id !== id),
    );
  };

  const applyWidgetConfig = () => {
    if (!configWidgetId) return;
    if (!dashboard) return;
    const name = widgetNameInput.trim();
    if (!name) return;
    if (selectedWidgetType === "table" && !selectedTable) return;

    updateDashboardWidget(dashboard.id, configWidgetId, {
      widgetType: selectedWidgetType,
      title: name,
      tableName: selectedWidgetType === "table" ? selectedTable : undefined,
      schema:
        selectedWidgetType === "table"
          ? selectedSchema || fallbackSchemaForDb || "public"
          : undefined,
      query:
        widgetSupportsConditions(selectedWidgetType) ||
        selectedWidgetType === "table" ||
        selectedWidgetType === "text"
          ? widgetQueryInput
          : "",
      content:
        selectedWidgetType === "text" ||
        selectedWidgetType === "image" ||
        selectedWidgetType === "gif"
          ? selectedWidgetType === "text"
            ? JSON.stringify({
                template: widgetContentInput,
                tintColor: textTintColor,
              } satisfies TextWidgetOptions)
            : widgetContentInput
          : selectedWidgetType === "metric"
            ? JSON.stringify({
                valueFormat: metricValueFormat,
                tintColor: metricTintColor,
                showChange: metricShowChange,
                colorByChange: metricColorByChange,
              } satisfies MetricWidgetOptions)
            : isBarLikeWidgetType(selectedWidgetType)
              ? JSON.stringify({
                  tintColor: barChartTintColor,
                  xLabel: barChartXLabel,
                  yLabel: barChartYLabel,
                } satisfies BarChartWidgetOptions)
              : isAreaLikeWidgetType(selectedWidgetType)
                ? JSON.stringify({
                    tintColor: areaChartTintColor,
                    xLabel: areaChartXLabel,
                    yLabel: areaChartYLabel,
                  } satisfies AreaChartWidgetOptions)
                : selectedWidgetType === "sparkline"
                  ? JSON.stringify({
                      tintColor: sparklineTintColor,
                      showIncrease: sparklineShowIncrease,
                    } satisfies SparklineWidgetOptions)
                  : selectedWidgetType === "pie-chart"
                    ? JSON.stringify({
                        tintColor: pieChartTintColor,
                      } satisfies PieChartWidgetOptions)
                    : selectedWidgetType === "map"
                      ? JSON.stringify({
                          pulse: mapPulse,
                        } satisfies MapWidgetOptions)
                      : "",
      conditions: widgetSupportsConditions(selectedWidgetType)
        ? conditionsInput
        : [],
    });
    setConfigOpen(false);
  };

  const widgetTypeRequiresQuery = widgetSupportsConditions(selectedWidgetType);
  const widgetTypeUsesConditions = widgetSupportsConditions(selectedWidgetType);
  const widgetTypeIsBarLike = isBarLikeWidgetType(selectedWidgetType);
  const widgetTypeIsAreaLike = isAreaLikeWidgetType(selectedWidgetType);
  const widgetTypeUsesContent =
    selectedWidgetType === "image" || selectedWidgetType === "gif";
  const widgetTypeUsesQuery =
    widgetTypeRequiresQuery ||
    selectedWidgetType === "table" ||
    selectedWidgetType === "text";
  const widgetQueryLintError = widgetTypeUsesQuery
    ? lintSqlQuery(widgetQueryInput)
    : "";
  const renderWidgetQueryEditor = (_placeholder: string, heightPx = 256) => (
    <div
      className={cn(
        "rounded-none border-0 bg-background/30 overflow-hidden",
        heightPx >= 200 ? "min-h-64" : "min-h-28",
      )}
    >
      <div className="relative">
        <MonacoEditor
          height={`${heightPx}px`}
          defaultLanguage="sql"
          language="sql"
          theme={resolvedEditorThemeId}
          value={widgetQueryInput}
          onChange={(value) => setWidgetQueryInput(value || "")}
          beforeMount={(monaco: any) => {
            monaco.editor.defineTheme("studio-dark", getStudioDarkTheme());
            if (appEditorTheme) {
              registerCustomMonacoThemes(monaco, [appEditorTheme]);
            }
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineNumbers: "off",
            glyphMargin: false,
            folding: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 10, bottom: 10 },
            lineHeight: 20,
            wordWrap: "on",
          }}
          onMount={(editor: any, monaco: any) => {
            monacoRef.current = monaco;
            vimDisposableRef.current?.dispose();
            vimDisposableRef.current = null;
            if (vimMode && vimStatusRef.current) {
              void import("monaco-vim")
                .then(({ initVimMode }) => {
                  if (vimStatusRef.current) {
                    vimDisposableRef.current = initVimMode(
                      editor,
                      vimStatusRef.current,
                    );
                  }
                })
                .catch(() => {});
            }
            editor.onDidDispose(() => {
              monacoRef.current = null;
              vimDisposableRef.current?.dispose();
              vimDisposableRef.current = null;
            });
          }}
        />
        {vimMode ? (
          <div
            ref={vimStatusRef}
            className="h-4 text-xs font-mono px-2 flex items-center text-muted-foreground/50 border-t border-border bg-background/60"
          />
        ) : null}
      </div>
    </div>
  );
  const ConditionRowEditor = ({
    condition,
    className,
    showRemove,
  }: {
    condition: DashboardCondition;
    className?: string;
    showRemove?: boolean;
  }) => (
    <div className={className ?? "grid grid-cols-2 gap-2"}>
      <Select
        value={condition.operator}
        onValueChange={(value: DashboardConditionOperator) =>
          updateConditionRow(condition.id, { operator: value })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPERATOR_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {condition.operator === "is_null" ||
      condition.operator === "is_not_null" ? (
        <Input value="(no value needed)" disabled />
      ) : (
        <Input
          value={condition.value || ""}
          onChange={(e) =>
            updateConditionRow(condition.id, { value: e.target.value })
          }
          placeholder="value"
        />
      )}
      {showRemove && (
        <button
          onClick={() => removeConditionRow(condition.id)}
          className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/20"
          title="Remove condition"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
  const renderReturnedRowsPreview = () => {
    if (!queryPreviewFields.length) return null;
    const previewRows = queryPreviewRows.slice(0, 8);
    return (
      <div className="rounded-[6px] border border-studio-border/80 bg-background/20 overflow-hidden">
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-studio-border/80">
          Returned rows: {queryPreviewRows.length}
        </div>
        <div className="max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/20">
              <tr>
                {queryPreviewFields.map((field) => (
                  <th
                    key={field}
                    className="px-2 py-1.5 text-left font-medium border-b border-studio-border/70 whitespace-nowrap"
                  >
                    {field}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => (
                <tr
                  key={`preview-row-${rowIndex}`}
                  className="border-b border-studio-border/40"
                >
                  {queryPreviewFields.map((field) => (
                    <td
                      key={`${rowIndex}-${field}`}
                      className="px-2 py-1.5 align-top whitespace-nowrap max-w-[240px] truncate"
                    >
                      {previewCellText(row[field])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {queryPreviewRows.length > previewRows.length ? (
          <div className="px-3 py-1.5 text-xs text-muted-foreground border-t border-studio-border/70">
            Showing {previewRows.length} of {queryPreviewRows.length} rows
          </div>
        ) : null}
      </div>
    );
  };
  const tablePreviewTitle = widgetNameInput || selectedTable || "Top Products";
  const tablePreviewSummary = selectedTable
    ? selectWithLimit(selectedTable, 100, dbType)
    : selectWithLimit("table", 100, dbType);
  const textPreviewResolved = renderTextTemplate(
    widgetContentInput,
    textPreviewRow,
  );
  const sparklinePreviewDeltaPct =
    sparklinePreviewData.length >= 2 && sparklinePreviewData[0].value !== 0
      ? ((sparklinePreviewData[sparklinePreviewData.length - 1].value -
          sparklinePreviewData[0].value) /
          Math.abs(sparklinePreviewData[0].value)) *
        100
      : null;
  const metricPreviewNumeric = toNumericValue(queryPreviewValue);
  const formattedMetricPreview =
    metricPreviewNumeric !== null
      ? metricValueFormat === "compact"
        ? new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 2,
          }).format(metricPreviewNumeric)
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
            metricPreviewNumeric,
          )
      : queryPreview
        ? queryPreview
        : "1,234";
  const metricDeltaColorClass =
    metricColorByChange &&
    queryPreviewDeltaPct !== null &&
    queryPreviewDeltaPct < 0
      ? "text-rose-300 border-rose-400/35 bg-rose-500/10"
      : metricColorByChange
        ? "text-emerald-300 border-emerald-400/35 bg-emerald-500/10"
        : "text-muted-foreground border-studio-border/80 bg-background/40";
  const metricPreviewBackground = getMetricTintBackground(metricTintColor);
  const piePreviewPalette = pieChartTintColor
    ? buildTintPalette(
        pieChartTintColor,
        Math.max(1, pieChartPreviewData.length),
      )
    : CHART_COLORS;

  const setResultPreviewFromData = (
    data:
      | {
          rows?: Array<Record<string, unknown>>;
          fields?: Array<{ name: string }>;
        }
      | null
      | undefined,
  ) => {
    const fields = (data?.fields || [])
      .map((field) => field.name)
      .filter(Boolean);
    const rows = Array.isArray(data?.rows)
      ? (data?.rows as Array<Record<string, unknown>>)
      : [];
    setQueryPreviewFields(fields);
    setQueryPreviewRows(rows);
  };

  if (!dashboard) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Open or create a dashboard from the sidebar.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 min-h-0 flex-col bg-studio-bg">
        <DashboardHeader
          onEditWithAi={() => onEditWithAi(dashboard)}
          onRefresh={handleRefresh}
          isLocked={isLocked}
          onToggleLock={onToggleLock}
          isRefreshing={isRefreshing}
        />
        <div
          ref={canvasRef}
          className={`relative h-full min-h-0 w-full flex-1 bg-background/20 overflow-auto ${isDrawing || activeTransform ? "select-none" : ""}`}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={finalizeDraftWidget}
          onDragStart={(e) => {
            if (isDrawing) e.preventDefault();
          }}
          onMouseLeave={() => {
            if (dragStart) finalizeDraftWidget();
          }}
        >
          {dashboard.widgets.length === 0 && !draftRect && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
              <div>
                <p className="text-sm text-muted-foreground">
                  Empty dashboard canvas
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Click and drag to draw your first widget.
                </p>
              </div>
            </div>
          )}

          {dashboard.widgets.map((widget) => {
            const live =
              activeTransform?.mode === "resize" &&
              activeTransform?.widgetId === widget.id
                ? liveWidgetDims[widget.id]
                : null;
            const displayWidth = live?.width ?? widget.width;
            const displayHeight = live?.height ?? widget.height;
            const effectiveWidget = live
              ? { ...widget, width: displayWidth, height: displayHeight }
              : widget;
            return (
              <div
                key={widget.id + "-" + refreshKey}
                data-widget-id={widget.id}
                ref={(el) => setWidgetRef(widget.id, el)}
                className="absolute"
                style={{
                  left: widget.x + WIDGET_GUTTER / 2,
                  top: widget.y + WIDGET_GUTTER / 2,
                  width: Math.max(0, displayWidth - WIDGET_GUTTER),
                  height: Math.max(0, displayHeight - WIDGET_GUTTER),
                  contain: "layout style paint",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                }}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <Card
                      className={`h-full border-studio-border rounded-[4px] relative overflow-hidden ${
                        hasMetricTint(widget)
                          ? "bg-transparent border-transparent p-0"
                          : "bg-secondary/40 p-3"
                      } ${
                        activeTransform?.widgetId === widget.id
                          ? "ring-1 ring-blue-500/60 border-blue-500/60"
                          : ""
                      }`}
                    >
                      <div
                        onMouseDown={(event) => beginWidgetMove(event, widget)}
                        className="absolute top-0 left-0 right-0 h-3 cursor-move z-10"
                        title="Move widget"
                      />
                      <div
                        onMouseDown={(event) =>
                          beginWidgetResize(event, widget)
                        }
                        className="absolute right-1 bottom-1 w-3 h-3 cursor-se-resize z-10"
                        title="Resize widget"
                      >
                        <div className="w-full h-full border-r border-b border-studio-border/80" />
                      </div>
                      {effectiveWidget.widgetType === "empty" ? (
                        <button
                          type="button"
                          onClick={() => openWidgetConfigurator(widget.id)}
                          className="h-full w-full rounded-[4px] border border-dashed border-studio-border/70 text-xs text-muted-foreground hover:text-foreground hover:border-studio-border transition-colors"
                        >
                          Click to set widget
                        </button>
                      ) : effectiveWidget.widgetType === "table" ? (
                        <TableWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          selectedSchema={selectedSchema}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "metric" ? (
                        <QueryMetricWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "area-chart" ? (
                        <QueryAreaChartWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "bar-chart" ? (
                        <QueryBarChartWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : isBarPatternWidgetType(effectiveWidget.widgetType) ? (
                        <QueryPatternBarChartWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : isAreaPatternWidgetType(
                          effectiveWidget.widgetType,
                        ) ? (
                        <QueryPatternAreaChartWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "p-chart-19" ? (
                        <QueryMetricBarWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "p-chart-20" ? (
                        <QueryDotMatrixWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : isStackedBarWidgetType(effectiveWidget.widgetType) ? (
                        <QueryStackedBarChartWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "pie-chart" ? (
                        <QueryPieChartWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "sparkline" ? (
                        <QuerySparklineWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "progress" ? (
                        <QueryProgressWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "map" ? (
                        <QueryMapWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "text" ? (
                        <QueryTextWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "image" ? (
                        <QueryValueWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          compact
                          fallbackMediaType="image"
                          fallbackMediaUrl={effectiveWidget.content}
                          refreshKey={refreshKey}
                        />
                      ) : effectiveWidget.widgetType === "gif" ? (
                        <QueryValueWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          compact
                          fallbackMediaType="gif"
                          fallbackMediaUrl={effectiveWidget.content}
                          refreshKey={refreshKey}
                        />
                      ) : isQueryWidgetType(effectiveWidget.widgetType) ? (
                        <QueryValueWidget
                          widget={effectiveWidget}
                          connectionString={connectionString}
                          compact
                          refreshKey={refreshKey}
                        />
                      ) : (
                        <GenericWidget widget={effectiveWidget} />
                      )}
                    </Card>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => openWidgetConfigurator(widget.id)}
                    >
                      Edit
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() =>
                        removeDashboardWidget(dashboard.id, widget.id)
                      }
                      className="text-destructive focus:text-destructive"
                    >
                      Remove
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            );
          })}

          {draftRect && (
            <div
              className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
              style={{
                left: draftRect.x,
                top: draftRect.y,
                width: draftRect.width,
                height: draftRect.height,
              }}
            />
          )}
        </div>
      </div>

      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Set Widget</SheetTitle>
            <SheetDescription>
              Configure widget type, query, and conditional outputs.
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Widget title"
                value={widgetNameInput}
                onChange={(e) => setWidgetNameInput(e.target.value)}
              />
              <Select
                value={selectedWidgetType}
                onValueChange={handleWidgetTypeChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                >
                  {WIDGET_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedWidgetType === "table" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Table</label>
                  <Select
                    value={selectedTable}
                    onValueChange={setSelectedTable}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select table" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      side="bottom"
                      align="start"
                      sideOffset={4}
                    >
                      {tables.map((table) => (
                        <SelectItem key={table} value={table}>
                          {table}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-[6px] border border-studio-border/80 overflow-hidden bg-gradient-to-b from-muted/20 to-background/50">
                  <div className="px-4 pt-4 pb-3">
                    <span className="text-xs text-muted-foreground truncate block">
                      {tablePreviewTitle}
                    </span>
                  </div>
                  <div className="border-t border-studio-border/80 bg-background/20 h-[320px] overflow-hidden">
                    <DataGrid
                      results={tablePreviewResults}
                      tableStructure={[]}
                      selectedRows={tablePreviewSelectedRows}
                      setSelectedRows={setTablePreviewSelectedRows}
                      toggleAllSelection={() => {
                        const previewRows = tablePreviewResults?.rows || [];
                        setTablePreviewSelectedRows((prev) =>
                          prev.size === previewRows.length
                            ? new Set()
                            : new Set(
                                previewRows.map((_: unknown, i: number) => i),
                              ),
                        );
                      }}
                      toggleRowSelection={createRowToggleHandler(
                        setTablePreviewSelectedRows,
                      )}
                      getRowId={dataGridRowIdGetter}
                      pendingChanges={{}}
                      setPendingChanges={() => {}}
                      editingCell={null}
                      setEditingCell={() => {}}
                      selectedCell={null}
                      setSelectedCell={() => {}}
                      selectedColumn={null}
                      setSelectedColumn={() => {}}
                      hasChanges={() => false}
                      getChangedValue={() => null}
                      handleUpdateRow={async () => {}}
                      handleFKSelection={async () => false}
                      handleFKPreview={() => {}}
                      loading={tablePreviewLoading}
                      fetchingStructure={false}
                      error={tablePreviewError || null}
                      isAddColumnSheetOpen={false}
                      setIsAddColumnSheetOpen={() => {}}
                      isAddingColumn={false}
                      handleAddColumn={async () => {}}
                      handleDeleteColumn={async () => {}}
                      columnToDelete={null}
                      setColumnToDelete={() => {}}
                      selectedTable={selectedTable || null}
                      sortConfig={null}
                      setSortConfig={() => {}}
                      pageSize={100}
                      page={0}
                      totalCount={tablePreviewResults?.rows?.length || 0}
                      onPageChange={() => {}}
                      onPageSizeChange={() => {}}
                      onDuplicateRow={() => {}}
                      onCopyRowJSON={() => {}}
                      onCopyRowCSV={() => {}}
                      rowSpacing="compact"
                      alternatingRowColors={false}
                      connectionString={connectionString}
                      foreignKeys={[]}
                      enableColumnHover={false}
                      showPaginationFooter={false}
                    />
                  </div>
                  <div className="px-4 py-2 border-t border-studio-border/80 text-muted-foreground font-mono text-xs">
                    {tablePreviewSummary}
                  </div>
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runTablePreviewAction}
                  error={tablePreviewError}
                  loading={tablePreviewLoading}
                  lintError={widgetQueryLintError}
                />
              </div>
            )}

            {selectedWidgetType === "text" && (
              <div className="space-y-3">
                <Textarea
                  className="min-h-28"
                  value={widgetContentInput}
                  onChange={(e) => setWidgetContentInput(e.target.value)}
                  placeholder='Product with most quantity is: "{{name}}" with {{stock_quantity}} items in stock'
                />

                <div
                  className="rounded-[6px] border border-studio-border/80 p-4 min-h-[220px] flex flex-col bg-gradient-to-b from-muted/20 to-background/50"
                  style={
                    textTintColor
                      ? {
                          backgroundImage:
                            getMetricTintBackground(textTintColor),
                        }
                      : undefined
                  }
                >
                  <div
                    className="text-xs truncate mb-2"
                    style={
                      textTintColor
                        ? { color: METRIC_TINT_TEXT_COLOR }
                        : undefined
                    }
                  >
                    {widgetNameInput || "Text"}
                  </div>
                  <div className="flex-1 flex items-center justify-center text-center">
                    <span className="font-space text-sm leading-snug font-semibold whitespace-pre-wrap break-words">
                      {textPreviewResolved ||
                        widgetContentInput ||
                        "Content to display"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options</p>
                  <WidgetTintPicker
                    value={textTintColor}
                    onChange={setTextTintColor}
                    label="text tint"
                  />
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runTextPreviewAction}
                  error={textPreviewError}
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {selectedWidgetType === "metric" && (
              <div className="space-y-3">
                <div
                  className="rounded-[6px] border border-studio-border/80 p-4 min-h-[170px] flex flex-col"
                  style={
                    metricPreviewBackground
                      ? { backgroundImage: metricPreviewBackground }
                      : undefined
                  }
                >
                  <MetricPreviewContent
                    title={widgetNameInput || "Metric"}
                    showChange={metricShowChange}
                    deltaPct={queryPreviewDeltaPct}
                    deltaBadgeClass={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold tabular-nums",
                      metricDeltaColorClass,
                    )}
                    colorByChange={metricColorByChange}
                    tintColor={metricTintColor}
                    formattedValue={formattedMetricPreview}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options</p>
                  <Select
                    value={metricValueFormat}
                    onValueChange={(value: "number" | "compact") =>
                      setMetricValueFormat(value)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      side="bottom"
                      align="start"
                      sideOffset={4}
                    >
                      <SelectItem value="number">Number (1,234)</SelectItem>
                      <SelectItem value="compact">Compact (1.2K)</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2.5 pt-1">
                    <WidgetTintPicker
                      value={metricTintColor}
                      onChange={setMetricTintColor}
                      label="metric tint"
                      triggerSize="sm"
                    />
                    <div className="inline-flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Show change
                      </span>
                      <Switch
                        checked={metricShowChange}
                        onCheckedChange={setMetricShowChange}
                        className="h-4 w-7 border border-studio-border/80 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-muted/20"
                        thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                      />
                    </div>
                    <div className="inline-flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Color by change
                      </span>
                      <Switch
                        checked={metricColorByChange}
                        onCheckedChange={setMetricColorByChange}
                        className="h-4 w-7 border border-studio-border/80 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-muted/20"
                        thumbClassName="size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Button variant="outline" size="sm" onClick={addConditionRow}>
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Condition
                  </Button>
                  {conditionsInput.map((condition, index) => {
                    const conditionColor = parseMetricConditionColor(
                      condition.actionValue,
                    );
                    const conditionBackground =
                      getMetricTintBackground(conditionColor);
                    return (
                      <div
                        key={condition.id}
                        className={`space-y-3 rounded-lg border p-3 ${
                          queryPreview &&
                          !queryPreviewError &&
                          matchesCondition(queryPreviewValue, condition)
                            ? "border-emerald-500/80 bg-emerald-500/5"
                            : "border-studio-border/70"
                        }`}
                      >
                        <div className="text-xs tracking-[0.14em]text-muted-foreground font-medium">
                          Condition {index + 1}
                        </div>
                        <ConditionRowEditor
                          condition={condition}
                          className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
                          showRemove
                        />
                        <div className="flex items-center">
                          <TintColorPicker
                            value={conditionColor}
                            onChange={(color) =>
                              updateConditionRow(condition.id, {
                                actionValue: color || "",
                              })
                            }
                            label="condition"
                            triggerSize="lg"
                          />
                        </div>
                        <div
                          className="rounded-[6px] border border-studio-border/80 p-4 min-h-[120px] flex flex-col"
                          style={
                            conditionBackground
                              ? { backgroundImage: conditionBackground }
                              : undefined
                          }
                        >
                          <MetricPreviewContent
                            title={widgetNameInput || "Metric"}
                            showChange={metricShowChange}
                            deltaPct={queryPreviewDeltaPct}
                            deltaBadgeClass={cn(
                              "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold tabular-nums",
                              metricColorByChange &&
                                queryPreviewDeltaPct !== null
                                ? queryPreviewDeltaPct < 0
                                  ? "text-rose-300 border-rose-400/35 bg-rose-500/10"
                                  : "text-emerald-300 border-emerald-400/35 bg-emerald-500/10"
                                : "text-muted-foreground border-studio-border/80 bg-background/40",
                            )}
                            colorByChange={metricColorByChange}
                            tintColor={conditionColor}
                            formattedValue={formattedMetricPreview}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runQueryPreviewAction}
                  error={queryPreviewError}
                  footerExtra={
                    queryPreview ? (
                      <span className="text-xs text-muted-foreground">
                        Returned value: {queryPreview}
                      </span>
                    ) : null
                  }
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {widgetTypeIsBarLike && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-studio-border/80 p-4 min-h-[170px] flex flex-col bg-gradient-to-b from-muted/20 to-background/50">
                  <div className="text-xs text-muted-foreground truncate mb-2">
                    {widgetNameInput || "Bar Chart"}
                  </div>
                  {selectedWidgetType === "bar-chart" ? (
                    <div className="h-[220px] relative pl-5 pb-5">
                      {barChartYLabel ? (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
                          {barChartYLabel}
                        </span>
                      ) : null}
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart
                          data={
                            barChartPreviewData.length
                              ? barChartPreviewData
                              : DEFAULT_BAR_CHART_PREVIEW_DATA
                          }
                          margin={{ top: 6, right: 4, left: 4, bottom: 8 }}
                        >
                          <YAxis hide />
                          <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            interval={1}
                            tick={{ fontSize: 11, fill: "#80889a" }}
                          />
                          <Bar
                            dataKey="value"
                            radius={[0, 0, 0, 0]}
                            fill={barChartTintColor || "#ef4444"}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                      {barChartXLabel ? (
                        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/80">
                          {barChartXLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : selectedWidgetType === "p-chart-19" ? (
                    <div className="h-[220px] flex flex-col">
                      <div
                        className="text-2xl font-bold tabular-nums mb-1"
                        style={{ color: barChartTintColor || "#3b82f6" }}
                      >
                        {barChartPreviewData.length
                          ? new Intl.NumberFormat("en-US", {
                              notation: "compact",
                              maximumFractionDigits: 2,
                            }).format(
                              barChartPreviewData[
                                barChartPreviewData.length - 1
                              ]?.value ?? 0,
                            )
                          : "33.9"}
                      </div>
                      <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={
                              barChartPreviewData.length
                                ? barChartPreviewData
                                : DEFAULT_BAR_CHART_PREVIEW_DATA
                            }
                            margin={{ top: 2, right: 4, left: -20, bottom: 0 }}
                            barCategoryGap="20%"
                          >
                            <XAxis
                              dataKey="label"
                              tick={{ fill: "#7f8796", fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                            <Bar
                              dataKey="value"
                              fill={barChartTintColor || "#3b82f6"}
                              radius={[2, 2, 0, 0]}
                              isAnimationActive={false}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : selectedWidgetType === "p-chart-20" ? (
                    <div className="h-[220px] flex flex-col">
                      {(() => {
                        const dotData = barChartPreviewData.length
                          ? barChartPreviewData
                          : DEFAULT_BAR_CHART_PREVIEW_DATA;
                        const maxVal = Math.max(...dotData.map((p) => p.value));
                        const ROWS = 8;
                        const cols = dotData.length;
                        const tint = barChartTintColor || "#3b82f6";
                        return (
                          <svg
                            width="100%"
                            height="100%"
                            viewBox={`0 0 ${cols * 16} ${ROWS * 16}`}
                            preserveAspectRatio="xMidYMid meet"
                            className="flex-1"
                          >
                            <DotMatrix data={dotData} maxVal={maxVal} rows={ROWS} cellSize={16} offset={8} radius={5} tintColor={tint} fillOpacity={0.85} />
                          </svg>
                        );
                      })()}
                    </div>
                  ) : isStackedBarWidgetType(selectedWidgetType) ? (
                    <div className="h-[220px] relative pb-5">
                      {(() => {
                        const previewSeriesKeys = barChartPreviewSeriesKeys.length
                          ? barChartPreviewSeriesKeys
                          : ["traffic", "ads", "position"];
                        const defaultStackedData: MultiSeriesChartPoint[] = [
                          { label: "Jan 1", traffic: 400, ads: 300, position: 200 },
                          { label: "Jan 5", traffic: 600, ads: 400, position: 150 },
                          { label: "Jan 10", traffic: 500, ads: 350, position: 250 },
                          { label: "Jan 15", traffic: 800, ads: 500, position: 300 },
                          { label: "Jan 20", traffic: 700, ads: 450, position: 200 },
                          { label: "Jan 25", traffic: 900, ads: 600, position: 350 },
                          { label: "Jan 30", traffic: 650, ads: 400, position: 180 },
                        ];
                        const previewData = barChartPreviewSeriesData.length
                          ? barChartPreviewSeriesData
                          : defaultStackedData;
                        return (
                          <>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                              {previewSeriesKeys.map((key, i) => (
                                <span
                                  key={key}
                                  className="flex items-center gap-1 text-xs"
                                  style={{ color: "#8b95a7" }}
                                >
                                  <span
                                    className="inline-block w-2 h-2 rounded-sm"
                                    style={{
                                      background:
                                        BAR_PATTERN_COLORS[
                                          i % BAR_PATTERN_COLORS.length
                                        ],
                                    }}
                                  />
                                  {formatSeriesLabel(key)}
                                </span>
                              ))}
                            </div>
                            <ChartContainer
                              config={buildPatternChartConfig(
                                previewSeriesKeys,
                                barChartTintColor,
                                widgetNameInput || "Value",
                              )}
                              className="h-[170px] w-full aspect-auto"
                            >
                              <BarChart
                                accessibilityLayer
                                data={previewData}
                                margin={{ top: 4, right: 4, left: -10, bottom: 8 }}
                                barCategoryGap="25%"
                              >
                                <CartesianGrid
                                  vertical={false}
                                  stroke="rgba(148,163,184,0.1)"
                                />
                                <XAxis
                                  dataKey="label"
                                  tickLine={false}
                                  axisLine={false}
                                  tick={{ fill: "#7f8796", fontSize: 10 }}
                                  tickFormatter={formatAxisLabel}
                                />
                                <YAxis
                                  tickLine={false}
                                  axisLine={false}
                                  tick={{ fill: "#7f8796", fontSize: 10 }}
                                  width={34}
                                />
                                <ChartTooltip content={<ChartTooltipContent />} />
                                {previewSeriesKeys.map((key, i) => (
                                  <Bar
                                    key={key}
                                    dataKey={key}
                                    stackId="stack"
                                    fill={
                                      BAR_PATTERN_COLORS[
                                        i % BAR_PATTERN_COLORS.length
                                      ]
                                    }
                                    radius={
                                      i === previewSeriesKeys.length - 1
                                        ? [2, 2, 0, 0]
                                        : [0, 0, 0, 0]
                                    }
                                    isAnimationActive={false}
                                  />
                                ))}
                              </BarChart>
                            </ChartContainer>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="h-[220px] relative pl-5 pb-5">
                      {(() => {
                        const isPatternMulti = BAR_PATTERN_MULTI_SERIES.has(
                          selectedWidgetType as BarPatternWidgetType,
                        );
                        const previewSeriesKeys = isPatternMulti
                          ? barChartPreviewSeriesKeys.length
                            ? barChartPreviewSeriesKeys
                            : ["desktop", "mobile"]
                          : ["value"];
                        const previewSeriesData = isPatternMulti
                          ? barChartPreviewSeriesData.length
                            ? barChartPreviewSeriesData
                            : DEFAULT_BAR_CHART_MULTI_SERIES_PREVIEW
                          : barChartPreviewData.length
                            ? barChartPreviewData.map((point) => ({
                                label: point.label,
                                value: point.value,
                              }))
                            : DEFAULT_BAR_CHART_SINGLE_SERIES_PREVIEW;
                        const primaryKey = previewSeriesKeys[0] || "value";
                        return (
                          <>
                            {barChartYLabel ? (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
                                {barChartYLabel}
                              </span>
                            ) : null}
                            <ChartContainer
                              config={buildPatternChartConfig(
                                previewSeriesKeys,
                                barChartTintColor,
                                widgetNameInput || "Series",
                              )}
                              className="h-full w-full aspect-auto"
                            >
                              <BarChart
                                accessibilityLayer
                                data={previewSeriesData}
                                layout={
                                  selectedWidgetType === "p-chart-12"
                                    ? "vertical"
                                    : "horizontal"
                                }
                                margin={
                                  selectedWidgetType === "p-chart-12"
                                    ? { left: -10, right: 20 }
                                    : { top: 6, right: 4, left: 4, bottom: 8 }
                                }
                                barCategoryGap={
                                  selectedWidgetType === "p-chart-12"
                                    ? "30%"
                                    : undefined
                                }
                              >
                                {(selectedWidgetType === "p-chart-3" ||
                                  selectedWidgetType === "p-chart-4") && (
                                  <defs>
                                    {selectedWidgetType === "p-chart-3" ? (
                                      <pattern
                                        id="bar-preview-striped"
                                        patternUnits="userSpaceOnUse"
                                        width="8"
                                        height="8"
                                      >
                                        <rect
                                          width="8"
                                          height="8"
                                          fill={`var(--color-${primaryKey})`}
                                          opacity="0.1"
                                        />
                                        <path
                                          d="M0,8 L8,0 M4,12 L12,4 M-4,4 L4,-4"
                                          stroke={`var(--color-${primaryKey})`}
                                          strokeWidth="1.5"
                                          opacity="0.6"
                                        />
                                        <path
                                          d="M2,10 L10,2 M6,14 L14,6 M-2,6 L6,-2"
                                          stroke={`var(--color-${primaryKey})`}
                                          strokeWidth="1"
                                          opacity="0.3"
                                        />
                                      </pattern>
                                    ) : (
                                      <pattern
                                        id="bar-preview-dotted"
                                        x="0"
                                        y="0"
                                        width="5"
                                        height="5"
                                        patternUnits="userSpaceOnUse"
                                      >
                                        <rect
                                          width="5"
                                          height="5"
                                          fill={`var(--color-${primaryKey})`}
                                          opacity="0.1"
                                        />
                                        <circle
                                          cx="5"
                                          cy="5"
                                          r="1.4"
                                          fill={`var(--color-${primaryKey})`}
                                          opacity={0.6}
                                        />
                                      </pattern>
                                    )}
                                  </defs>
                                )}
                                {selectedWidgetType === "p-chart-1" ||
                                selectedWidgetType === "p-chart-2" ? (
                                  <CartesianGrid vertical={false} />
                                ) : null}
                                {selectedWidgetType === "p-chart-12" ? (
                                  <>
                                    <YAxis
                                      type="category"
                                      dataKey="label"
                                      tickLine={false}
                                      tickMargin={10}
                                      axisLine={false}
                                    />
                                    <XAxis
                                      type="number"
                                      tickLine={false}
                                      tickMargin={10}
                                      axisLine={false}
                                      hide
                                    />
                                  </>
                                ) : (
                                  <XAxis
                                    dataKey="label"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={8}
                                  />
                                )}
                                {previewSeriesKeys.map((seriesKey, index) => {
                                  const isPatternFill =
                                    (selectedWidgetType === "p-chart-3" ||
                                      selectedWidgetType === "p-chart-4") &&
                                    index === 0;
                                  const fillId =
                                    selectedWidgetType === "p-chart-3"
                                      ? "bar-preview-striped"
                                      : "bar-preview-dotted";
                                  return (
                                    <Bar
                                      key={seriesKey}
                                      dataKey={seriesKey}
                                      fill={
                                        isPatternFill
                                          ? `url(#${fillId})`
                                          : `var(--color-${seriesKey})`
                                      }
                                      stroke={
                                        isPatternFill
                                          ? `var(--color-${seriesKey})`
                                          : undefined
                                      }
                                      strokeWidth={
                                        isPatternFill ? 1 : undefined
                                      }
                                      radius={
                                        selectedWidgetType === "p-chart-12"
                                          ? 2
                                          : 4
                                      }
                                    />
                                  );
                                })}
                              </BarChart>
                            </ChartContainer>
                            {barChartXLabel ? (
                              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/80">
                                {barChartXLabel}
                              </span>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options</p>
                  <WidgetTintPicker
                    value={barChartTintColor}
                    onChange={setBarChartTintColor}
                    label="bar"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={barChartXLabel}
                      onChange={(e) => setBarChartXLabel(e.target.value)}
                      placeholder="e.g. Month"
                    />
                    <Input
                      value={barChartYLabel}
                      onChange={(e) => setBarChartYLabel(e.target.value)}
                      placeholder="e.g. Revenue"
                    />
                  </div>
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runBarChartPreviewAction}
                  error={barChartPreviewError}
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {widgetTypeIsAreaLike && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-studio-border/80 p-4 min-h-[170px] flex flex-col bg-gradient-to-b from-muted/20 to-background/50">
                  <div className="text-xs text-muted-foreground truncate mb-2">
                    {widgetNameInput || "Area Chart"}
                  </div>
                  <div className="h-[220px] relative pl-5 pb-5">
                    {areaChartYLabel ? (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-top-left text-xs text-muted-foreground/80">
                        {areaChartYLabel}
                      </span>
                    ) : null}
                    {selectedWidgetType === "area-chart" ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart
                          data={
                            areaChartPreviewData.length
                              ? areaChartPreviewData
                              : DEFAULT_AREA_CHART_PREVIEW_DATA
                          }
                          margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
                        >
                          <WidgetAreaDefsAndAxis
                            seriesKeys={
                              areaChartPreviewSeriesKeys.length
                                ? areaChartPreviewSeriesKeys
                                : ["products", "baseline"]
                            }
                            tintColor={areaChartTintColor}
                            gradientId={(seriesKey) =>
                              `area-preview-fill-${seriesKey}`
                            }
                            tickFill="#80889a"
                          />
                          <YAxis hide domain={["dataMin", "dataMax"]} />
                          {(areaChartPreviewSeriesKeys.length
                            ? areaChartPreviewSeriesKeys
                            : ["products", "baseline"]
                          ).map((seriesKey, index) => (
                            <Area
                              key={seriesKey}
                              type="monotone"
                              dataKey={seriesKey}
                              stroke={
                                index === 0 && areaChartTintColor
                                  ? areaChartTintColor
                                  : CHART_COLORS[index % CHART_COLORS.length]
                              }
                              strokeWidth={2}
                              fill={`url(#area-preview-fill-${seriesKey})`}
                              dot={false}
                            />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <>
                        {(() => {
                          const isMulti = AREA_PATTERN_MULTI_SERIES.has(
                            selectedWidgetType as AreaPatternWidgetType,
                          );
                          const previewSeriesKeys = isMulti
                            ? areaChartPreviewSeriesKeys.length
                              ? areaChartPreviewSeriesKeys
                              : ["products", "baseline"]
                            : [areaChartPreviewSeriesKeys[0] || "products"];
                          const primaryKey = previewSeriesKeys[0] || "products";
                          return (
                            <ChartContainer
                              config={buildPatternChartConfig(
                                previewSeriesKeys,
                                areaChartTintColor,
                                widgetNameInput || "Series",
                              )}
                              className="h-full w-full aspect-auto"
                            >
                              {selectedWidgetType === "p-chart-17" ? (
                                <ComposedChart
                                  data={
                                    areaChartPreviewData.length
                                      ? areaChartPreviewData
                                      : DEFAULT_AREA_CHART_PREVIEW_DATA
                                  }
                                  margin={{
                                    top: 8,
                                    right: 6,
                                    left: 0,
                                    bottom: 0,
                                  }}
                                >
                                  <defs>
                                    <pattern
                                      id="area-preview-forecast"
                                      patternUnits="userSpaceOnUse"
                                      width="6"
                                      height="6"
                                    >
                                      <rect
                                        width="6"
                                        height="6"
                                        fill={`var(--color-${primaryKey})`}
                                        opacity="0.04"
                                      />
                                      <path
                                        d="M0,6 L6,0"
                                        stroke={`var(--color-${primaryKey})`}
                                        strokeWidth="0.8"
                                        opacity="0.15"
                                      />
                                    </pattern>
                                  </defs>
                                  <ChartGridAndAxis />
                                  <Area
                                    dataKey={primaryKey}
                                    type="natural"
                                    fill="url(#area-preview-forecast)"
                                    stroke="none"
                                  />
                                  <Line
                                    dataKey={primaryKey}
                                    type="natural"
                                    stroke={`var(--color-${primaryKey})`}
                                    strokeWidth={2.5}
                                    dot={false}
                                  />
                                </ComposedChart>
                              ) : (
                                <AreaChart
                                  data={
                                    areaChartPreviewData.length
                                      ? areaChartPreviewData
                                      : DEFAULT_AREA_CHART_PREVIEW_DATA
                                  }
                                  margin={{
                                    top: 8,
                                    right: 6,
                                    left: 0,
                                    bottom: 0,
                                  }}
                                >
                                  <defs>
                                    {selectedWidgetType === "p-chart-13" ||
                                    selectedWidgetType === "p-chart-14"
                                      ? previewSeriesKeys.map((seriesKey) => (
                                          <linearGradient
                                            key={seriesKey}
                                            id={`area-preview-grad-${seriesKey}`}
                                            x1="0"
                                            y1="0"
                                            x2="0"
                                            y2="1"
                                          >
                                            <stop
                                              offset="5%"
                                              stopColor={`var(--color-${seriesKey})`}
                                              stopOpacity={0.5}
                                            />
                                            <stop
                                              offset="95%"
                                              stopColor={`var(--color-${seriesKey})`}
                                              stopOpacity={0.1}
                                            />
                                          </linearGradient>
                                        ))
                                      : null}
                                    {selectedWidgetType === "p-chart-15" ? (
                                      <pattern
                                        id="area-preview-dot"
                                        patternUnits="userSpaceOnUse"
                                        width="5"
                                        height="5"
                                      >
                                        <rect
                                          width="5"
                                          height="5"
                                          fill={`var(--color-${primaryKey})`}
                                          opacity="0.08"
                                        />
                                        <circle
                                          cx="2.5"
                                          cy="2.5"
                                          r="1"
                                          fill={`var(--color-${primaryKey})`}
                                          opacity="0.5"
                                        />
                                      </pattern>
                                    ) : null}
                                    {selectedWidgetType === "p-chart-18"
                                      ? previewSeriesKeys.map((seriesKey) => (
                                          <pattern
                                            key={seriesKey}
                                            id={`area-preview-cross-${seriesKey}`}
                                            x="0"
                                            y="0"
                                            width="8"
                                            height="8"
                                            patternUnits="userSpaceOnUse"
                                          >
                                            <path
                                              d="M0,8 L8,0"
                                              stroke={`var(--color-${seriesKey})`}
                                              strokeWidth="0.8"
                                              opacity="0.4"
                                            />
                                            <path
                                              d="M0,0 L8,8"
                                              stroke={`var(--color-${seriesKey})`}
                                              strokeWidth="0.8"
                                              opacity="0.2"
                                            />
                                          </pattern>
                                        ))
                                      : null}
                                  </defs>
                                  <ChartGridAndAxis />
                                  {previewSeriesKeys.map((seriesKey) => {
                                    const fill =
                                      selectedWidgetType === "p-chart-15"
                                        ? "url(#area-preview-dot)"
                                        : selectedWidgetType === "p-chart-18"
                                          ? `url(#area-preview-cross-${seriesKey})`
                                          : selectedWidgetType ===
                                                "p-chart-13" ||
                                              selectedWidgetType ===
                                                "p-chart-14"
                                            ? `url(#area-preview-grad-${seriesKey})`
                                            : `var(--color-${seriesKey})`;
                                    return (
                                      <Area
                                        key={seriesKey}
                                        dataKey={seriesKey}
                                        type={
                                          selectedWidgetType === "p-chart-15"
                                            ? "stepAfter"
                                            : "natural"
                                        }
                                        stackId={
                                          selectedWidgetType === "p-chart-14" ||
                                          selectedWidgetType === "p-chart-18"
                                            ? "a"
                                            : undefined
                                        }
                                        fill={fill}
                                        fillOpacity={
                                          selectedWidgetType === "p-chart-18"
                                            ? 0.5
                                            : 0.35
                                        }
                                        stroke={`var(--color-${seriesKey})`}
                                        strokeWidth={
                                          selectedWidgetType === "p-chart-14"
                                            ? 0.8
                                            : 2
                                        }
                                        strokeDasharray={
                                          selectedWidgetType === "p-chart-14"
                                            ? "3 3"
                                            : undefined
                                        }
                                        dot={false}
                                      />
                                    );
                                  })}
                                </AreaChart>
                              )}
                            </ChartContainer>
                          );
                        })()}
                      </>
                    )}
                    {areaChartXLabel ? (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/80">
                        {areaChartXLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options</p>
                  <WidgetTintPicker
                    value={areaChartTintColor}
                    onChange={setAreaChartTintColor}
                    label="area chart"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={areaChartXLabel}
                      onChange={(e) => setAreaChartXLabel(e.target.value)}
                      placeholder="Day"
                    />
                    <Input
                      value={areaChartYLabel}
                      onChange={(e) => setAreaChartYLabel(e.target.value)}
                      placeholder="Count"
                    />
                  </div>
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runAreaChartPreviewAction}
                  error={areaChartPreviewError}
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {selectedWidgetType === "sparkline" && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-studio-border/80 p-4 min-h-[170px] flex flex-col bg-gradient-to-b from-muted/20 to-background/50">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground truncate">
                      {widgetNameInput || "Sparkline"}
                    </div>
                    {sparklineShowIncrease &&
                    sparklinePreviewDeltaPct !== null ? (
                      <span className="text-xs tabular-nums text-emerald-300">
                        {sparklinePreviewDeltaPct >= 0 ? "+" : ""}
                        {sparklinePreviewDeltaPct.toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart
                        data={sparklinePreviewData}
                        margin={{ top: 8, right: 2, left: 2, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="sparkline-preview-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor={sparklineTintColor || "#3b82f6"}
                              stopOpacity={0.35}
                            />
                            <stop
                              offset="100%"
                              stopColor="#0f1b31"
                              stopOpacity={0.05}
                            />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="label" hide />
                        <YAxis hide domain={["dataMin", "dataMax"]} />
                        <Area
                          type="linear"
                          dataKey="value"
                          stroke={sparklineTintColor || "#3b82f6"}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                          fill="url(#sparkline-preview-fill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options</p>
                  <div className="flex items-center gap-4">
                    <WidgetTintPicker
                      value={sparklineTintColor}
                      onChange={setSparklineTintColor}
                      label="sparkline"
                    />
                    <div className="inline-flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Show increase
                      </span>
                      <Switch
                        checked={sparklineShowIncrease}
                        onCheckedChange={setSparklineShowIncrease}
                        className="h-6 w-11 border border-studio-border/80 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-muted/20"
                        thumbClassName="size-5 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5"
                      />
                    </div>
                  </div>
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runSparklinePreviewAction}
                  error={sparklinePreviewError}
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {selectedWidgetType === "pie-chart" && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-studio-border/80 p-4 min-h-[170px] flex flex-col bg-gradient-to-b from-muted/20 to-background/50">
                  <div className="text-xs text-muted-foreground truncate mb-2">
                    {widgetNameInput || "Pie Chart"}
                  </div>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={pieChartPreviewData}
                          dataKey="value"
                          nameKey="label"
                          innerRadius={40}
                          outerRadius={78}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {pieChartPreviewData.map((entry, index) => (
                            <Cell
                              key={`pie-preview-${entry.label}-${index}`}
                              fill={
                                piePreviewPalette[
                                  index % piePreviewPalette.length
                                ]
                              }
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options</p>
                  <WidgetTintPicker
                    value={pieChartTintColor}
                    onChange={setPieChartTintColor}
                    label="pie chart"
                  />
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runPieChartPreviewAction}
                  error={pieChartPreviewError}
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {selectedWidgetType === "map" && (
              <div className="space-y-3">
                <div className="rounded-[6px] border border-studio-border/80 p-4 min-h-[170px] flex flex-col bg-gradient-to-b from-muted/20 to-background/50">
                  <div className="h-[260px]">
                    <MapPreviewPanel
                      title={widgetNameInput || "Map"}
                      points={
                        mapPreviewPoints.length
                          ? mapPreviewPoints
                          : DEFAULT_MAP_POINTS
                      }
                      pulse={mapPulse}
                    />
                  </div>
                </div>

                <div className="inline-flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Pulse
                  </span>
                  <Switch
                    checked={mapPulse}
                    onCheckedChange={setMapPulse}
                    className="h-6 w-11 border border-studio-border/80 data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-muted/20"
                    thumbClassName="size-5 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5"
                  />
                </div>

                <RunQuerySection
                  editor={renderWidgetQueryEditor("")}
                  onRun={runMapPreviewAction}
                  error={mapPreviewError}
                  lintError={widgetQueryLintError}
                />
                {queryPreviewFields.length ? renderReturnedRowsPreview() : null}
              </div>
            )}

            {selectedWidgetType !== "metric" &&
              !widgetTypeIsBarLike &&
              !widgetTypeIsAreaLike &&
              selectedWidgetType !== "sparkline" &&
              selectedWidgetType !== "pie-chart" &&
              selectedWidgetType !== "map" &&
              selectedWidgetType !== "text" &&
              widgetTypeRequiresQuery && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Query</label>
                  {renderWidgetQueryEditor("SELECT ...", 112)}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={runQueryPreviewAction}
                      disabled={!!widgetQueryLintError}
                    >
                      Run Query
                    </Button>
                    {queryPreview ? (
                      <span className="text-xs text-muted-foreground">
                        Returned value: {queryPreview}
                      </span>
                    ) : null}
                    {queryPreviewError ? (
                      <span className="text-xs text-destructive">
                        {queryPreviewError}
                      </span>
                    ) : null}
                  </div>
                  {queryPreviewFields.length
                    ? renderReturnedRowsPreview()
                    : null}
                </div>
              )}

            {widgetTypeUsesContent && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Media URL
                </label>
                <Input
                  value={widgetContentInput}
                  onChange={(e) => setWidgetContentInput(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}

            {selectedWidgetType !== "metric" &&
              !widgetTypeIsBarLike &&
              !widgetTypeIsAreaLike &&
              selectedWidgetType !== "sparkline" &&
              selectedWidgetType !== "pie-chart" &&
              selectedWidgetType !== "map" &&
              widgetTypeUsesConditions && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Evaluate the first column of the first row and apply
                    conditional output.
                  </p>
                  {conditionsInput.map((condition, index) => (
                    <div
                      key={condition.id}
                      className={`space-y-2 rounded-lg border p-3 ${
                        queryPreview &&
                        !queryPreviewError &&
                        matchesCondition(queryPreviewValue, condition)
                          ? "border-emerald-500/80 bg-emerald-500/5"
                          : "border-studio-border/70"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Condition {index + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          {queryPreview &&
                          !queryPreviewError &&
                          matchesCondition(queryPreviewValue, condition) ? (
                            <span className="text-xs font-mediumtracking-wide text-emerald-400">
                              Matches
                            </span>
                          ) : null}
                          <button
                            onClick={() => removeConditionRow(condition.id)}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/20"
                            title="Remove condition"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <ConditionRowEditor condition={condition} />
                      <div className="grid grid-cols-1 gap-2">
                        <Input
                          value={condition.actionValue}
                          onChange={(e) =>
                            updateConditionRow(condition.id, {
                              actionValue: e.target.value,
                            })
                          }
                          placeholder={
                            conditionActionType === "text"
                              ? "text output"
                              : "https://..."
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Output type: {conditionActionTypeLabel}
                        </p>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addConditionRow}>
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Condition
                  </Button>
                </div>
              )}
          </div>

          <SheetFooter>
            {widgetTypeUsesQuery && widgetQueryLintError ? (
              <p className="w-full text-xs text-destructive">
                {widgetQueryLintError}
              </p>
            ) : null}
            <Button variant="secondary" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={applyWidgetConfig}
              disabled={
                !configWidget ||
                !widgetNameInput.trim() ||
                (selectedWidgetType === "table" && !selectedTable) ||
                !!widgetQueryLintError
              }
            >
              Apply
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
