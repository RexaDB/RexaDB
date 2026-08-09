import { DASHBOARD_GRID_SIZE, DASHBOARD_MIN_SIZE, Dashboard, DashboardFolder } from "./types";

export function snapToDashboardGrid(value: number) {
  return Math.round(value / DASHBOARD_GRID_SIZE) * DASHBOARD_GRID_SIZE;
}

export function snapDashboardPosition(value: number) {
  return Math.max(0, snapToDashboardGrid(value));
}

export function snapDashboardSize(value: number) {
  return Math.max(DASHBOARD_MIN_SIZE, snapToDashboardGrid(value));
}

function normalizeWidgets(widgets: any[]) {
  if (!Array.isArray(widgets)) return [];
  return widgets.map((widget: any, index: number) => ({
    id: widget.id,
    widgetType: widget.widgetType || (widget.tableName ? "table" : "empty"),
    title: widget.title || `Widget ${index + 1}`,
    query: widget.query || "",
    tableName: widget.tableName || undefined,
    schema: widget.schema || undefined,
    content: widget.content || "",
    conditions: Array.isArray(widget.conditions) ? widget.conditions : [],
    x: snapDashboardPosition(typeof widget.x === "number" ? widget.x : 40 + (index % 2) * 440),
    y: snapDashboardPosition(typeof widget.y === "number" ? widget.y : 40 + Math.floor(index / 2) * 280),
    width: snapDashboardSize(typeof widget.width === "number" ? widget.width : 400),
    height: snapDashboardSize(typeof widget.height === "number" ? widget.height : 240),
  }));
}

export function normalizeDashboards(rawDashboards: any[], options?: { idAsString?: boolean; folderKey?: string; isShared?: boolean }): Dashboard[] {
  return rawDashboards.map((dashboard: any) => ({
    id: options?.idAsString ? String(dashboard.id) : dashboard.id,
    name: dashboard.name,
    folderId: typeof (options?.folderKey ? dashboard[options.folderKey] : dashboard.folderId) === "string"
      ? (options?.folderKey ? dashboard[options.folderKey] : dashboard.folderId) : null,
    isShared: options?.isShared ?? Boolean(dashboard.isShared),
    widgets: normalizeWidgets(dashboard.widgets),
  }));
}

export function normalizeDashboardFolders(rawFolders: any[]): DashboardFolder[] {
  return rawFolders
    .filter((folder: any) => typeof folder?.id === "string" && typeof folder?.name === "string")
    .map((folder: any) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? folder.parent_id ?? null,
      createdAt: folder.createdAt ?? (folder.created_at ? new Date(folder.created_at).getTime() : Date.now()),
    }));
}
