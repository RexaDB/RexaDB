import { NODE_REGISTRY_MAP } from "@/lib/workflows/node-registry-data";
import { parseAppThemeJson, BUILTIN_APP_THEMES } from "@/lib/studio/app-themes";
import { createThemeId, parseThemeJson } from "@/lib/studio/editor-themes";
import { ensureReadOnlySql } from "@/lib/db/sql-guards";
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

function requireName(value: unknown, label: string): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error(`${label} name is required.`);
  return name;
}

function assertWidgetQuery(widget: DashboardWidgetInput, dbType: string) {
  const query = String(widget.query ?? "").trim();
  if (!query) {
    if (widget.type !== "text") throw new Error(`Widget "${widget.title}" needs a query.`);
    return;
  }
  if (dbType === "mongodb" || dbType === "redis") return;
  try {
    ensureReadOnlySql(query);
  } catch (error) {
    throw new Error(`Widget "${widget.title}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function prepareDashboardArtifact(input: DashboardArtifactInput, dbType: string): StudioArtifact {
  const name = requireName(input.name, "Dashboard");
  const widgets = Array.isArray(input.widgets) ? input.widgets : [];
  if (widgets.length === 0) throw new Error("A dashboard needs at least one widget.");
  for (const widget of widgets) {
    if (!(DASHBOARD_WIDGET_TYPES as readonly string[]).includes(widget.type)) {
      throw new Error(`Unknown widget type "${widget.type}". Use one of: ${DASHBOARD_WIDGET_TYPES.join(", ")}.`);
    }
    assertWidgetQuery(widget, dbType);
  }
  return {
    kind: "dashboard",
    action: input.dashboardId ? "update" : "create",
    ...(input.dashboardId ? { dashboardId: input.dashboardId } : {}),
    dashboard: { name, widgets },
  };
}

export function prepareWorkflowArtifact(plan: AgentWorkflowPlan): StudioArtifact {
  const name = requireName(plan.name, "Workflow");
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const edges = Array.isArray(plan.edges) ? plan.edges : [];
  if (nodes.length === 0) throw new Error("A workflow needs at least one node.");

  const ids = new Set<string>();
  for (const node of nodes) {
    const def = NODE_REGISTRY_MAP.get(node.type);
    if (!def || def.implemented !== true) throw new Error(`Unknown workflow node type "${node.type}".`);
    if (ids.has(node.id)) throw new Error(`Duplicate node id "${node.id}".`);
    ids.add(node.id);
    for (const field of def.fields) {
      const value = node.config?.[field.key] ?? field.defaultValue;
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new Error(`Node "${node.id}" (${node.type}) is missing required field "${field.key}".`);
      }
    }
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error(`Edge "${edge.id}" references a node that does not exist.`);
    }
  }
  return {
    kind: "workflow",
    action: plan.workflowId ? "update" : "create",
    plan: { ...plan, name, nodes, edges },
  };
}

export function prepareAppThemeArtifact(
  input: { name: string; base: "light" | "dark"; colors: Record<string, string> },
  existingIds: Set<string> = new Set(BUILTIN_APP_THEMES.map((theme) => theme.id)),
): Extract<StudioArtifact, { kind: "theme" }> {
  const validated = parseAppThemeJson(JSON.stringify(input));
  if (validated.error || !validated.theme) throw new Error(validated.error || "Invalid theme definition.");
  const { name, base, colors } = validated.theme;
  const theme = { id: createThemeId(input.name, existingIds), name, base, colors };
  return { kind: "theme", action: "create", theme: { type: "app", autoApply: true, theme } };
}

export function prepareEditorThemeArtifact(
  input: { name: string; themeJson: string },
  existingIds: Set<string> = new Set(),
): Extract<StudioArtifact, { kind: "theme" }> {
  const parsed = parseThemeJson(input.themeJson);
  if (parsed.error) throw new Error(parsed.error);
  const theme = {
    id: createThemeId(input.name || parsed.name || "", existingIds),
    name: parsed.name || input.name,
    themeJson: input.themeJson,
  };
  return { kind: "theme", action: "create", theme: { type: "editor", autoApply: true, theme } };
}

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
