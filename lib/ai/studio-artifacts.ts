import type { AgentWorkflowPlan } from "@/lib/ai/types";

export type ParsedThemeBlock =
  | { type: "app"; autoApply?: boolean; theme: { id: string; name: string; base: "light" | "dark"; colors?: Record<string, string> } }
  | { type: "editor"; autoApply?: boolean; theme: { id: string; name: string; themeJson?: string } };

export const DASHBOARD_WIDGET_TYPES = [
  "metric", "table", "text", "bar-chart", "area-chart", "pie-chart", "sparkline", "map", "progress",
  "p-chart-1", "p-chart-2", "p-chart-3", "p-chart-4", "p-chart-12", "p-chart-13", "p-chart-14",
  "p-chart-15", "p-chart-17", "p-chart-18", "p-chart-19", "p-chart-20", "p-chart-21",
] as const;

export type DashboardWidgetInput = {
  title: string;
  type: (typeof DASHBOARD_WIDGET_TYPES)[number];
  query?: string;
  tintColor?: string;
  xLabel?: string;
  yLabel?: string;
  valueFormat?: "number" | "compact";
  showChange?: boolean;
  colorByChange?: boolean;
  template?: string;
};

export type DashboardArtifactInput = { name: string; widgets: DashboardWidgetInput[]; dashboardId?: string };

/** A validated tool result the studio applies when it arrives in the chat stream. */
export type StudioArtifact =
  | { kind: "dashboard"; action: "create" | "update"; dashboardId?: string; dashboard: { name: string; widgets: DashboardWidgetInput[] } }
  | { kind: "workflow"; action: "create" | "update"; plan: AgentWorkflowPlan }
  | { kind: "theme"; action: "create"; theme: ParsedThemeBlock };

export const APP_COLOR_KEYS_DESCRIPTION = [
  "YOU MUST INCLUDE ALL of these CSS variables as keys, each with a real color value:",
  "--background, --foreground, --card, --card-foreground, --popover, --popover-foreground,",
  "--primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground,",
  "--accent, --accent-foreground, --destructive, --border, --input, --ring,",
  "--chart-1, --chart-2, --chart-3, --chart-4, --chart-5,",
  "--sidebar, --sidebar-foreground, --sidebar-primary, --sidebar-primary-foreground,",
  "--sidebar-accent, --sidebar-accent-foreground, --sidebar-border, --sidebar-ring,",
  "--studio-bg, --studio-border, --studio-header-bg, --table-header-bg, --studio-cell-text,",
  "--studio-cell-muted, --studio-tab-active, --studio-tab-inactive, --studio-row-hover,",
  "--studio-selection (use rgba), --studio-accent-purple.",
].join("\n");

export function isStudioArtifact(value: unknown): value is StudioArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Record<string, any>;
  if (artifact.kind === "dashboard") return Array.isArray(artifact.dashboard?.widgets);
  if (artifact.kind === "workflow") return Array.isArray(artifact.plan?.nodes);
  if (artifact.kind === "theme") return typeof artifact.theme?.theme?.id === "string";
  return false;
}

export function describeStudioArtifact(artifact: StudioArtifact): string {
  const verb = artifact.action === "update" ? "Updated" : "Created";
  if (artifact.kind === "dashboard") return `${verb} dashboard "${artifact.dashboard.name}" with ${artifact.dashboard.widgets.length} widget(s).`;
  if (artifact.kind === "workflow") return `${verb} workflow "${artifact.plan.name}" with ${artifact.plan.nodes.length} node(s).`;
  return `${verb} ${artifact.theme.type} theme "${artifact.theme.theme.name}".`;
}

export function serializeMessageArtifacts(artifacts: StudioArtifact[]): string {
  return JSON.stringify({ artifacts });
}

export function readMessageArtifacts(metaJson?: string | null): StudioArtifact[] {
  if (!metaJson) return [];
  try {
    const artifacts = JSON.parse(metaJson)?.artifacts;
    return Array.isArray(artifacts) ? artifacts.filter(isStudioArtifact) : [];
  } catch {
    return [];
  }
}

/** Keeps tool-created results visible to the model on later turns of the chat. */
export function messageTextForHistory(content: string, metaJson?: string | null): string {
  return [content, ...readMessageArtifacts(metaJson).map(describeStudioArtifact)].filter(Boolean).join("\n\n");
}
