import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  APP_COLOR_KEYS_DESCRIPTION,
  DASHBOARD_WIDGET_TYPES,
  describeStudioArtifact,
  type StudioArtifact,
} from "../../ai/studio-artifacts";
import {
  prepareAppThemeArtifact,
  prepareDashboardArtifact,
  prepareEditorThemeArtifact,
  prepareWorkflowArtifact,
} from "../../ai/studio-artifact-prepare";

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

type StudioTool = {
  description: string;
  shape: Record<string, z.ZodType>;
  prepare: (args: any, dbType: string) => StudioArtifact;
};

export const STUDIO_TOOLS: Record<string, StudioTool> = {
  create_dashboard: {
    description: "Create a dashboard in RexaDB Studio.",
    shape: { name: z.string(), widgets },
    prepare: prepareDashboardArtifact,
  },
  update_dashboard: {
    description: "Add widgets to an existing dashboard or replace widgets that share a type and title.",
    shape: { dashboardId: z.string().describe("Dashboard id from the dashboard context"), name: z.string(), widgets },
    prepare: prepareDashboardArtifact,
  },
  create_workflow: {
    description: "Create a workflow in RexaDB Studio.",
    shape: workflow,
    prepare: (args) => prepareWorkflowArtifact(args),
  },
  update_workflow: {
    description: "Replace the nodes and edges of an existing workflow.",
    shape: { workflowId: z.string().describe("Existing workflow id"), ...workflow },
    prepare: (args) => prepareWorkflowArtifact(args),
  },
  create_app_theme: {
    description: "Create and apply a custom RexaDB app color theme.",
    shape: {
      name: z.string(),
      base: z.enum(["light", "dark"]),
      colors: z.record(z.string(), z.string()).describe(APP_COLOR_KEYS_DESCRIPTION),
    },
    prepare: (args) => prepareAppThemeArtifact(args),
  },
  create_editor_theme: {
    description: "Create and apply a custom SQL editor theme from VS Code or Monaco theme JSON.",
    shape: { name: z.string(), themeJson: z.string().describe("VS Code or Monaco theme JSON") },
    prepare: (args) => prepareEditorThemeArtifact(args),
  },
};

/** Tools for RexaDB chat only: the studio applies each artifact, so Agents and external clients must not get them. */
export function registerStudioArtifactTools(
  server: McpServer,
  deps: { dbType: string; publish: (artifact: StudioArtifact) => void },
) {
  for (const [name, tool] of Object.entries(STUDIO_TOOLS)) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: toolShape(tool.shape),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const artifact = tool.prepare(args, deps.dbType);
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
  }
}
