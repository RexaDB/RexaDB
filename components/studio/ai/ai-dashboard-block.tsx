"use client";

import { LayoutDashboard, PlusSquare } from "@/lib/icon-theme/lucide-react";

import { Button } from "@/components/ui/button";
import { countDashboardBlockWidgets } from "@/lib/ai/dashboard-plan";

function summarizeWidgets(dashboard: any) {
  const widgets = Array.isArray(dashboard?.widgets)
    ? dashboard.widgets
    : Array.isArray(dashboard?.charts)
      ? dashboard.charts
      : [];
  const metrics = widgets.filter((widget: any) =>
    String(widget?.type || "").includes("metric"),
  ).length;
  const tables = widgets.filter(
    (widget: any) => String(widget?.type || "") === "table",
  ).length;
  const parts = [
    metrics > 0 ? `${metrics} metric${metrics === 1 ? "" : "s"}` : null,
    tables > 0 ? `${tables} table${tables === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join(", ")
    : `${widgets.length} widget${widgets.length === 1 ? "" : "s"}`;
}

export function AiDashboardBlock({
  dashboard,
  applyLabel = "Create Dashboard",
  onApplyDashboard,
}: {
  dashboard: any;
  applyLabel?: string;
  onApplyDashboard: (dashboard: any) => void;
}) {
  const widgetCount = countDashboardBlockWidgets(dashboard);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {String(dashboard?.title || dashboard?.name || "Dashboard")}
          </span>
        </div>

        <span className="text-xs text-muted-foreground">
          {widgetCount} widget{widgetCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-xs text-muted-foreground">
          {summarizeWidgets(dashboard)}
        </p>

        <Button
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={() => onApplyDashboard(dashboard)}
          variant="outline"
        >
          <PlusSquare className="h-3.5 w-3.5" />
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
