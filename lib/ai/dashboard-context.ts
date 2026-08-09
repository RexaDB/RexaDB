import type { LightDashboardContext } from "@/lib/ai/types";
import { buildDashboardRef } from "@/lib/ai/dashboard-refs";

export function buildLightDashboardContext(dashboards: any[]): LightDashboardContext[] {
  return (Array.isArray(dashboards) ? dashboards : []).map((dashboard: any) => ({
    id: String(dashboard?.id || ""),
    ref: buildDashboardRef(String(dashboard?.name || "dashboard"), String(dashboard?.id || "")),
    name: String(dashboard?.name || "Dashboard"),
    widgets: Array.isArray(dashboard?.widgets)
      ? dashboard.widgets.map((widget: any) => ({
          id: String(widget?.id || ""),
          widgetType: String(widget?.widgetType || "metric"),
          title: String(widget?.title || "Widget"),
          query: typeof widget?.query === "string" ? widget.query : undefined,
          x: Number.isFinite(widget?.x) ? Number(widget.x) : undefined,
          y: Number.isFinite(widget?.y) ? Number(widget.y) : undefined,
          width: Number.isFinite(widget?.width) ? Number(widget.width) : undefined,
          height: Number.isFinite(widget?.height) ? Number(widget.height) : undefined,
        }))
      : [],
  })).filter((dashboard) => dashboard.id && dashboard.ref);
}
