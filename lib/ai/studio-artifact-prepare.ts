import { NODE_REGISTRY_MAP } from "@/lib/workflows/node-registry-data";
import { parseAppThemeJson } from "@/lib/studio/app-themes";
import { createThemeId, parseThemeJson } from "@/lib/studio/editor-themes";
import { ensureReadOnlyMongoQuery } from "@/lib/db/mongo-client";
import { ensureReadOnlyRedisCommand, ensureReadOnlySql } from "@/lib/db/sql-guards";
import { DASHBOARD_WIDGET_TYPES, type DashboardArtifactInput, type DashboardWidgetInput, type StudioArtifact } from "@/lib/ai/studio-artifacts";
import type { AgentWorkflowPlan } from "@/lib/ai/types";

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
  try {
    if (dbType === "mongodb") ensureReadOnlyMongoQuery(query);
    else if (dbType === "redis") ensureReadOnlyRedisCommand(query);
    else ensureReadOnlySql(query);
  } catch (error) {
    throw new Error(`Widget "${widget.title}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Callers that cannot read saved themes get a random suffix instead of replacing one. */
function themeId(name: string, existingIds?: Set<string>): string {
  if (existingIds) return createThemeId(name, existingIds);
  return `${createThemeId(name, new Set())}-${crypto.randomUUID().slice(0, 8)}`;
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
  existingIds?: Set<string>,
): Extract<StudioArtifact, { kind: "theme" }> {
  const validated = parseAppThemeJson(JSON.stringify(input));
  if (validated.error || !validated.theme) throw new Error(validated.error || "Invalid theme definition.");
  const { name, base, colors } = validated.theme;
  const theme = { id: themeId(input.name, existingIds), name, base, colors };
  return { kind: "theme", action: "create", theme: { type: "app", autoApply: true, theme } };
}

export function prepareEditorThemeArtifact(
  input: { name: string; themeJson: string },
  existingIds?: Set<string>,
): Extract<StudioArtifact, { kind: "theme" }> {
  const parsed = parseThemeJson(input.themeJson);
  if (parsed.error) throw new Error(parsed.error);
  const theme = {
    id: themeId(input.name || parsed.name || "", existingIds),
    name: parsed.name || input.name,
    themeJson: input.themeJson,
  };
  return { kind: "theme", action: "create", theme: { type: "editor", autoApply: true, theme } };
}
