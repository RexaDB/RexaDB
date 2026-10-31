import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  APP_COLOR_KEYS_DESCRIPTION,
  DASHBOARD_WIDGET_TYPES,
  describeStudioArtifact,
  prepareAppThemeArtifact,
  prepareDashboardArtifact,
  prepareEditorThemeArtifact,
  prepareWorkflowArtifact,
  type StudioArtifact,
} from "../../ai/studio-artifacts";

const toolShape = (shape: Record<string, z.ZodType>) => shape as any;

const widgets = z.array(z.object({
  title: z.string(),
  type: z.enum(DASHBOARD_WIDGET_TYPES),
  query: z.string().optional().describe("Read-only query. Required for every type except text."),
  tintColor: z.string().optional().describe("Hex color"),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  valueFormat: z.enum(["number", "compact"]).optional(),
  showChange: z.boolean().optional(),
  colorByChange: z.boolean().optional(),
  template: z.string().optional().describe("Text widget template with {{column}} placeholders"),
})).min(1);

const workflow = {
  name: z.string().describe("Workflow name"),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string().describe("Node type from the catalog"),
    name: z.string(),
    config: z.record(z.string(), z.unknown()),
  })).min(1),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
};

/** Tools for RexaDB chat only: the studio applies each artifact, so Agents and external clients must not get them. */
export function registerStudioArtifactTools(
  server: McpServer,
  deps: { dbType: string; publish: (artifact: StudioArtifact) => void },
) {
  const register = (
    name: string,
    description: string,
    shape: Record<string, z.ZodType>,
    prepare: (args: any) => StudioArtifact,
  ) => server.registerTool(
    name,
    {
      description,
      inputSchema: toolShape(shape),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const artifact = prepare(args);
        deps.publish(artifact);
        return { content: [{ type: "text" as const, text: describeStudioArtifact(artifact) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true as const,
        };
      }
    },
  );

  register("create_dashboard", "Create a dashboard in RexaDB Studio.", { name: z.string(), widgets }, (args) =>
    prepareDashboardArtifact(args, deps.dbType));
  register(
    "update_dashboard",
    "Add widgets to an existing dashboard or replace widgets that share a type and title.",
    { dashboardId: z.string().describe("Dashboard id from the dashboard context"), name: z.string(), widgets },
    (args) => prepareDashboardArtifact(args, deps.dbType),
  );
  register("create_workflow", "Create a workflow in RexaDB Studio.", workflow, (args) => prepareWorkflowArtifact(args));
  register(
    "update_workflow",
    "Replace the nodes and edges of an existing workflow.",
    { workflowId: z.string().describe("Existing workflow id"), ...workflow },
    (args) => prepareWorkflowArtifact(args),
  );
  register(
    "create_app_theme",
    "Create and apply a custom RexaDB app color theme.",
    {
      name: z.string(),
      base: z.enum(["light", "dark"]),
      colors: z.record(z.string(), z.string()).describe(APP_COLOR_KEYS_DESCRIPTION),
    },
    (args) => prepareAppThemeArtifact(args),
  );
  register(
    "create_editor_theme",
    "Create and apply a custom SQL editor theme from VS Code or Monaco theme JSON.",
    { name: z.string(), themeJson: z.string().describe("VS Code or Monaco theme JSON") },
    (args) => prepareEditorThemeArtifact(args),
  );
}
